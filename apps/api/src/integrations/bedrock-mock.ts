import { randomUUID } from "node:crypto";
import type {
  AnthropicMessage,
  ClaudeCallInput,
  ClaudeCallOutput,
} from "./bedrock.js";

/**
 * Deterministic mock for the Bedrock Claude endpoint used in CI and offline
 * evals. The real model is stochastic; these mocks implement just enough
 * tool-calling behavior to exercise the orchestrator's branches:
 *
 *   - Classifier prompt → returns one word from {faq,booking,clinical,complaint,spam}
 *   - Reasoning prompt → runs a tiny pattern-matcher over the latest user
 *     message to decide which tool to call next, or to emit a final answer.
 *
 * This is *not* a stand-in for real model evals. The real Bedrock path is
 * exercised in staging before production deploys.
 */

export async function mockInvokeClaude(
  input: ClaudeCallInput,
): Promise<ClaudeCallOutput> {
  const isClassifier = /classif(y|ier)/i.test(input.system);
  const lastUserText = extractLastUserText(input.messages).toLowerCase();

  if (isClassifier) {
    const intent = classify(lastUserText);
    return {
      stopReason: "end_turn",
      content: [{ type: "text", text: intent }],
      usage: { inputTokens: 50, outputTokens: 5 },
    };
  }

  const last = input.messages[input.messages.length - 1];

  if (last && isToolResultTurn(last)) {
    const toolContent = toolResultContent(last);
    if (toolContent.startsWith("BOOKING_CONFIRMED")) {
      const serviceMatch = toolContent.match(/service=(.+)$/);
      const service = serviceMatch?.[1]?.trim() ?? "your appointment";
      return textOut(
        `You're booked for your ${service} — I'll send a reminder 24h before. Reply here if anything changes.`,
      );
    }
    if (toolContent.startsWith("ESCALATED")) {
      return textOut(
        "Thanks for your patience — a team member will follow up with you shortly.",
      );
    }
    if (toolContent.startsWith("CONVERSATION_ENDED")) {
      return textOut("Talk soon!");
    }
    if (looksLikeAvailability(toolContent)) {
      return textOut(
        `I see an opening shortly. Would you like me to book that? Please reply with your name to confirm.`,
      );
    }
    return textOut(summarizeForPatient(toolContent));
  }

  const userText = lastUserText;

  // Complaint / adverse reaction → escalate (agent's system prompt tells it to)
  if (
    /\b(refund|swollen|allergic reaction|rash|hurt|pain|infection|bruise|worried|reacting)/i.test(
      userText,
    )
  ) {
    return toolUse("escalate_to_human", {
      reason: "complaint",
      summary: "Patient reports discomfort/adverse reaction — needs human follow-up.",
    });
  }

  const inBookingFlow = booking_flow_active(input.messages);

  if (inBookingFlow) {
    const confirms =
      /\b(yes|yep|yeah|confirm|go ahead|sounds good|book it|let'?s do it|that works|perfect)\b/i.test(
        userText,
      );
    if (confirms) {
      const serviceId = guessServiceId(
        historyText(input.messages),
        input.system,
      );
      const start = pickProposedSlot(input.messages) ?? defaultFutureSlot();
      const name =
        extractName(historyText(input.messages)) ??
        extractName(userText) ??
        "Patient";
      return toolUse("create_booking", {
        service_id: serviceId,
        start_iso: start,
        contact_name: name,
      });
    }
    // Patient is still giving details (time preference, name). Acknowledge
    // and ask for explicit confirmation.
    const name = extractName(userText) ?? extractName(historyText(input.messages));
    const ack = name
      ? `Got it ${name} — reply YES to confirm and I'll book it.`
      : `Got it — reply YES to confirm and I'll book it.`;
    return textOut(ack);
  }

  if (/book|appointment|availab|schedul|slot|squeeze|fit me in/i.test(userText)) {
    const now = new Date();
    const to = new Date(now);
    to.setDate(now.getDate() + 7);
    const serviceId = guessServiceId(
      userText + " " + historyText(input.messages),
      input.system,
    );
    return toolUse("check_availability", {
      service_id: serviceId,
      from_iso: now.toISOString(),
      to_iso: to.toISOString(),
    });
  }

  if (/(hour|open|closed|location|park|polic|cancel|fee|price|cost|much|\$)/i.test(userText)) {
    return toolUse("search_knowledge", { query: userText.slice(0, 120) });
  }

  return toolUse("search_knowledge", { query: userText.slice(0, 120) });
}

function booking_flow_active(messages: AnthropicMessage[]): boolean {
  // True iff we already proposed a slot in this conversation. We check two
  // signals so it works both within a single turn (tool_use is in the live
  // messages array) and across turns (the prior assistant text has been
  // persisted and rehydrated by the orchestrator — but tool_use isn't):
  //
  //   (a) Any assistant tool_use for check_availability in the current loop
  //   (b) Any prior assistant text message that contains our stock
  //       post-availability prompt ("opening shortly" / "reply with your name")
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (typeof m.content === "string") {
      if (
        m.role === "assistant" &&
        /opening shortly|reply with your name/i.test(m.content)
      ) {
        return true;
      }
      continue;
    }
    for (const c of m.content) {
      if (
        (c as { type?: string }).type === "tool_use" &&
        (c as { name?: string }).name === "check_availability"
      ) {
        return true;
      }
      if (
        (c as { type?: string }).type === "text" &&
        m.role === "assistant" &&
        /opening shortly|reply with your name/i.test(
          (c as { text: string }).text,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function historyText(messages: AnthropicMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") parts.push(m.content);
    else
      for (const c of m.content)
        if ((c as { type?: string }).type === "text")
          parts.push((c as { text: string }).text);
  }
  return parts.join(" ");
}

function pickProposedSlot(messages: AnthropicMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m.content === "string") continue;
    for (const c of m.content) {
      if ((c as { type?: string }).type !== "tool_result") continue;
      const tr = c as { content: string };
      try {
        const parsed = JSON.parse(tr.content) as Array<{ start: string }>;
        if (Array.isArray(parsed) && parsed[0]?.start) return parsed[0].start;
      } catch {
        // not availability JSON
      }
    }
  }
  return null;
}

function defaultFutureSlot(): string {
  const when = new Date();
  when.setDate(when.getDate() + 2);
  when.setHours(14, 0, 0, 0);
  return when.toISOString();
}

export async function mockEmbedText(text: string): Promise<number[]> {
  return wordHashEmbedding(text);
}

/**
 * Word-hash embedding for eval determinism. Each lowercased word hashes to a
 * stable index in the 1024-dim vector, so chunks sharing rare words end up
 * close in cosine space. Dramatically better than char-frequency for keyword
 * retrieval without pulling a real model into tests.
 *
 * Exported so the seed code can produce the same embedding shape.
 */
export function wordHashEmbedding(text: string): number[] {
  const v = new Array<number>(1024).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  for (const tok of tokens) {
    const idx = fnv1a(tok) % 1024;
    v[idx] = (v[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function classify(t: string): string {
  if (/\b(pregnan|dosage|allergy|side effect|safe for me|botox.*safe|is it ok|medication|medical history|breastfeed|contraind)/.test(t))
    return "clinical";
  if (/\b(refund|swollen|allergic reaction|rash|hurt|pain|infection|bruise|worried|reacting)/.test(t))
    return "complaint";
  if (/\b(seo|ranking|partnership|lead gen|marketing agency|seograph|outreach)\b/.test(t))
    return "spam";
  // Informational mentions of "policy/hours/location" are FAQ even when the
  // user also uses the word "reschedule/cancel".
  if (/\b(policy|hour|open|closed|location|park|address|directions)\b/.test(t))
    return "faq";
  if (/\b(book|appointment|availab|schedul|slot|reschedule my|cancel my|move my appt|move it)/.test(t))
    return "booking";
  return "faq";
}

function textOut(s: string): ClaudeCallOutput {
  return {
    stopReason: "end_turn",
    content: [{ type: "text", text: s }],
    usage: { inputTokens: 100, outputTokens: Math.ceil(s.length / 4) },
  };
}

function toolUse(name: string, input: unknown): ClaudeCallOutput {
  return {
    stopReason: "tool_use",
    content: [{ type: "tool_use", id: `mock_${randomUUID()}`, name, input }],
    usage: { inputTokens: 120, outputTokens: 20 },
  };
}

function extractLastUserText(messages: AnthropicMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const textOnly = m.content.find(
      (c): c is { type: "text"; text: string } =>
        (c as { type?: string }).type === "text",
    );
    if (textOnly) return textOnly.text;
  }
  return "";
}

function isToolResultTurn(m: AnthropicMessage): boolean {
  if (typeof m.content === "string") return false;
  return m.content.some(
    (c) => (c as { type?: string }).type === "tool_result",
  );
}

function toolResultContent(m: AnthropicMessage): string {
  if (typeof m.content === "string") return "";
  for (const c of m.content) {
    if ((c as { type?: string }).type === "tool_result") {
      const tr = c as { content: string };
      return tr.content ?? "";
    }
  }
  return "";
}

function looksLikeAvailability(s: string): boolean {
  return /"start":/.test(s) && /"end":/.test(s);
}

function summarizeForPatient(kb: string): string {
  const first = kb.split("\n").find((l) => l.length > 20) ?? kb.slice(0, 160);
  return first.replace(/^\[\d+\]\s*/, "").replace(/\(src:[^)]+\)\s*$/, "").trim();
}

function guessServiceId(userText: string, system: string): string {
  const ids: string[] = [];
  for (const match of system.matchAll(/id=([a-z0-9_-]+)/gi)) {
    if (match[1]) ids.push(match[1]);
  }
  for (const id of ids) {
    if (userText.includes(id.replace(/[_-]/g, " "))) return id;
    if (userText.includes(id)) return id;
  }
  if (/hydrafacial|facial/.test(userText))
    return ids.find((i) => i.includes("hydra")) ?? ids[0] ?? "consult";
  if (/botox/.test(userText))
    return ids.find((i) => i.includes("botox")) ?? ids[0] ?? "consult";
  if (/laser/.test(userText))
    return ids.find((i) => i.includes("laser")) ?? ids[0] ?? "consult";
  if (/microneedl/.test(userText))
    return ids.find((i) => i.includes("microneedl")) ?? ids[0] ?? "consult";
  return ids[0] ?? "consult";
}

function extractName(userText: string): string | null {
  const m = userText.match(/name is ([A-Za-z][A-Za-z '\-]{1,40})/i);
  if (m && m[1]) return m[1].trim();
  const m2 = userText.match(/i'?m ([A-Za-z][A-Za-z '\-]{1,40})/i);
  if (m2 && m2[1]) return m2[1].trim();
  return null;
}
