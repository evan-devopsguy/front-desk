import type { PoolClient } from "pg";
import {
  invokeClaude,
  reasoningModelId,
  type AnthropicMessage,
} from "../integrations/bedrock.js";
import { buildSystemPrompt } from "./prompts.js";
import { classifyIntent } from "./classifier.js";
import { buildOwnerAlertBody } from "./owner-alert.js";
import { getToolDefinitions, runTool, type ToolContext } from "./tools.js";
import type { BookingAdapter } from "../integrations/booking/types.js";
import {
  insertMessage,
  listMessages,
  updateConversationStatus,
} from "../db/repository.js";
import { auditWithin } from "../lib/audit.js";
import { logger } from "../lib/logger.js";
import { redactString } from "../lib/pii.js";
import type { TenantConfig, Intent } from "@medspa/shared";
import type { Vertical } from "../verticals/types.js";

export interface OrchestrateInput {
  client: PoolClient;
  tenant: { id: string; name: string; config: TenantConfig };
  conversationId: string;
  contactPhoneE164: string;
  inboundText: string;
  bookingAdapter: BookingAdapter;
  vertical: Vertical;
  notifyOwner: (summary: string, reason: string) => Promise<void>;
  /** Maximum tool-use iterations per turn. Caps runaway loops and cost. */
  maxIterations?: number;
}

export interface OrchestrateOutput {
  replyText: string;
  intent: Intent;
  outcome: "awaiting_patient" | "booked" | "escalated" | "ended" | "abandoned";
  iterations: number;
}

/**
 * Process one inbound contact message. Steps:
 *   1. Classify intent (Haiku). Vertical-driven escalation categories short-
 *      circuit the LLM entirely (medspa: "clinical"). Others fall through to
 *      the LLM loop with a post-check that enforces the escalation tool.
 *   2. Load prior turns → build messages array.
 *   3. Loop: invoke Sonnet with tools → run tool calls → feed results back.
 *   4. Stop when assistant emits a text reply with no tool calls, or when
 *      a terminal tool (escalate/end/booking) fires, or at max iterations.
 *   5. Persist inbound + assistant + tool messages; return reply text.
 *
 * The *entire* orchestration runs inside the caller's tenant transaction, so
 * any PHI write obeys RLS and is covered by the DB-level audit trigger.
 */
export async function orchestrate(
  input: OrchestrateInput,
): Promise<OrchestrateOutput> {
  const maxIter = input.maxIterations ?? 6;

  // 1) persist the inbound message (role varies by vertical)
  await insertMessage(input.client, {
    tenantId: input.tenant.id,
    conversationId: input.conversationId,
    role: input.vertical.contactRole,
    content: input.inboundText,
  });

  // 2) classify
  const intent = await classifyIntent({
    message: input.inboundText,
    vertical: input.vertical,
    fallback: input.vertical.classifierFallback,
  });
  await auditWithin(input.client, {
    tenantId: input.tenant.id,
    actor: "agent",
    action: "classifier_decision",
    resourceType: "conversation",
    resourceId: input.conversationId,
    metadata: { intent },
  });

  const mustEscalate = input.vertical.escalation.alwaysEscalateCategories.includes(intent);

  if (mustEscalate && input.vertical.escalation.escalationTool === "escalate_to_human") {
    // Medspa clinical path: short-circuit, skip LLM, canned reply.
    const summary = `${intent} intent detected — routed to human per safety policy.`;
    await updateConversationStatus(input.client, input.conversationId, "escalated");
    await auditWithin(input.client, {
      tenantId: input.tenant.id,
      actor: "agent",
      action: "conversation_escalated",
      resourceType: "conversation",
      resourceId: input.conversationId,
      metadata: { reason: intent, auto: true },
    });
    await input.notifyOwner(summary, intent).catch(() => {});
    const reply = `Thanks for reaching out! For anything clinical, I'll have a ${input.tenant.name} team member follow up directly so you get the right answer. Talk soon.`;
    await insertMessage(input.client, {
      tenantId: input.tenant.id,
      conversationId: input.conversationId,
      role: "assistant",
      content: reply,
    });
    return { replyText: reply, intent, outcome: "escalated", iterations: 0 };
  }
  // For escalationTool === "notify_owner" (garage-doors): fall through to LLM loop.
  // The post-check below enforces the tool call after the loop.

  // 3) build messages
  const priorMessages = await listMessages(
    input.client,
    input.conversationId,
    40,
  );
  const anthropicMessages: AnthropicMessage[] = priorMessages
    .filter((m) => m.role === "patient" || m.role === "contact" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "patient" || m.role === "contact" ? "user" : "assistant",
      content: m.content,
    }));

  const toolCtx: ToolContext = {
    client: input.client,
    tenantId: input.tenant.id,
    tenantConfig: input.tenant.config,
    conversationId: input.conversationId,
    contactPhoneE164: input.contactPhoneE164,
    bookingAdapter: input.bookingAdapter,
    notifyOwner: input.notifyOwner,
  };

  const system = buildSystemPrompt({
    vertical: input.vertical,
    tenant: { name: input.tenant.name, config: input.tenant.config },
    nowIso: new Date().toISOString(),
  });

  let iterations = 0;
  let outcome: OrchestrateOutput["outcome"] = "awaiting_patient";
  let replyText = "";
  let notifyOwnerFired = false;

  while (iterations < maxIter) {
    iterations++;
    const res = await invokeClaude({
      modelId: reasoningModelId(),
      system,
      messages: anthropicMessages,
      tools: getToolDefinitions(input.vertical.tools),
      maxTokens: 800,
      temperature: 0.3,
    });

    await auditWithin(input.client, {
      tenantId: input.tenant.id,
      actor: "agent",
      action: "llm_call",
      resourceType: "conversation",
      resourceId: input.conversationId,
      metadata: {
        model: "reasoning",
        stopReason: res.stopReason,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        iteration: iterations,
      },
    });

    const toolUses = res.content.filter(
      (c): c is { type: "tool_use"; id: string; name: string; input: unknown } =>
        c.type === "tool_use",
    );
    const textParts = res.content.filter(
      (c): c is { type: "text"; text: string } => c.type === "text",
    );

    // Record the assistant's turn (both text and tool_use stay attached)
    anthropicMessages.push({ role: "assistant", content: res.content });

    if (toolUses.length === 0) {
      replyText = textParts.map((t) => t.text).join("\n").trim();
      break;
    }

    const toolResults: AnthropicMessage["content"] = [];
    for (const call of toolUses) {
      const out = await runTool(
        toolCtx,
        call.name,
        (call.input ?? {}) as Record<string, unknown>,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: out.content,
        is_error: out.isError,
      });
      await insertMessage(input.client, {
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        role: "tool",
        content: out.content,
        toolCalls: { name: call.name, input: call.input, outcome: out.outcome },
      });
      if (call.name === "notify_owner") notifyOwnerFired = true;
      if (out.outcome === "booked") outcome = "booked";
      if (out.outcome === "escalated") outcome = "escalated";
      if (out.outcome === "ended") outcome = "ended";
      if (out.outcome === "abandoned") outcome = "abandoned";
    }
    anthropicMessages.push({ role: "user", content: toolResults });

    if (
      outcome === "escalated" ||
      outcome === "abandoned" ||
      outcome === "ended"
    ) {
      // Let the model produce a final acknowledgement text on the next loop
      // unless stop reason already shows end_turn.
      if (res.stopReason !== "tool_use") break;
    }
  }

  // Enforce escalation for verticals where the agent MUST call the escalation tool.
  if (mustEscalate && input.vertical.escalation.escalationTool === "notify_owner" && !notifyOwnerFired) {
    logger.warn(
      { conversationId: input.conversationId, intent },
      "orchestrator: forcing notify_owner — agent did not call it before end_conversation",
    );
    const urgency = (intent === "emergency" ? "emergency" : "complaint") as "emergency" | "complaint";
    const rawSummary = redactString(input.inboundText).slice(0, 160);
    const body = buildOwnerAlertBody({
      tenantName: input.tenant.config.displayName,
      urgency,
      summary: rawSummary,
      callbackPhone: input.contactPhoneE164,
      slaMinutes: input.vertical.escalation.slaMinutesByUrgency?.[urgency],
    });
    await input.notifyOwner(body, urgency).catch(() => {});
    await auditWithin(input.client, {
      tenantId: input.tenant.id,
      actor: "agent",
      action: "notify_owner",
      resourceType: "conversation",
      resourceId: input.conversationId,
      metadata: { urgency, forced: true },
    });
    if (outcome === "awaiting_patient") {
      outcome = "escalated";
      await updateConversationStatus(input.client, input.conversationId, "escalated");
    }
  }

  if (!replyText) {
    // Fallback: the loop hit max iterations without a textual answer.
    logger.warn(
      { conversationId: input.conversationId, iterations },
      "orchestrator: no final text, emitting safe fallback",
    );
    replyText = `Thanks for your patience — let me hand this to a team member and they'll follow up shortly.`;
    if (outcome === "awaiting_patient") outcome = "escalated";
    await updateConversationStatus(
      input.client,
      input.conversationId,
      "escalated",
    );
  }

  // Apply configured sign-off if defined and not already present
  const signOff = input.tenant.config.voice.signOff;
  if (signOff && !replyText.includes(signOff)) {
    const joined = `${replyText}\n${signOff}`;
    replyText = joined.length <= input.tenant.config.voice.maxSmsChars
      ? joined
      : replyText;
  }

  await insertMessage(input.client, {
    tenantId: input.tenant.id,
    conversationId: input.conversationId,
    role: "assistant",
    content: replyText,
  });

  return { replyText, intent, outcome, iterations };
}
