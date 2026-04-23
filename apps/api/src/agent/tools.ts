import type { PoolClient } from "pg";
import type { AnthropicTool } from "../integrations/bedrock.js";
import { retrieveKnowledge } from "../rag/retrieve.js";
import {
  insertBooking,
  updateConversationStatus,
} from "../db/repository.js";
import { auditWithin } from "../lib/audit.js";
import { hashPhone } from "../lib/pii.js";
import type {
  BookingAdapter,
  BookingAdapterError,
} from "../integrations/booking/types.js";
import type { TenantConfig } from "@medspa/shared";

export const TOOL_DEFINITIONS: AnthropicTool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the spa's knowledge base (services, policies, pricing, FAQs). Use for every factual claim the patient asks about.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A focused natural-language query, e.g. 'Botox pricing' or 'cancellation policy'.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check_availability",
    description:
      "Check open appointment slots for a given service between two ISO datetimes. Use BEFORE proposing times to the patient.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service id from the menu" },
        from_iso: {
          type: "string",
          description: "ISO datetime lower bound (inclusive).",
        },
        to_iso: {
          type: "string",
          description: "ISO datetime upper bound (inclusive).",
        },
      },
      required: ["service_id", "from_iso", "to_iso"],
    },
  },
  {
    name: "create_booking",
    description:
      "Book an appointment. ONLY call after confirming service, datetime, and contact name with the caller.",
    input_schema: {
      type: "object",
      properties: {
        service_id: { type: "string" },
        start_iso: { type: "string" },
        contact_name: { type: "string" },
      },
      required: ["service_id", "start_iso", "contact_name"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Mark the conversation for human follow-up. Use for clinical questions, complaints, adverse reactions, or anything outside safe scope.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["clinical", "complaint", "after-hours", "spam", "manual"],
        },
        summary: {
          type: "string",
          description: "One-sentence summary for the owner. No PHI.",
        },
      },
      required: ["reason", "summary"],
    },
  },
  {
    name: "end_conversation",
    description:
      "End the conversation. Use when the patient says goodbye, confirmed a booking, or the thread is clearly done.",
    input_schema: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["booked", "abandoned", "ended"],
        },
      },
      required: ["outcome"],
    },
  },
];

export interface ToolContext {
  client: PoolClient;
  tenantId: string;
  tenantConfig: TenantConfig;
  conversationId: string;
  contactPhoneE164: string;
  bookingAdapter: BookingAdapter;
  /** Used for SMS owner notifications on escalation. */
  notifyOwner: (summary: string, reason: string) => Promise<void>;
}

export interface ToolOutput {
  content: string;
  isError: boolean;
  /** Side effects the orchestrator should react to (e.g. terminate loop). */
  outcome?: "escalated" | "booked" | "ended" | "abandoned";
}

export async function runTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  switch (name) {
    case "search_knowledge":
      return searchKnowledge(ctx, input);
    case "check_availability":
      return checkAvailability(ctx, input);
    case "create_booking":
      return createBooking(ctx, input);
    case "escalate_to_human":
      return escalate(ctx, input);
    case "end_conversation":
      return endConversation(ctx, input);
    default:
      return { content: `unknown tool: ${name}`, isError: true };
  }
}

async function searchKnowledge(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const query = String(input.query ?? "").trim();
  if (!query)
    return { content: "query is required", isError: true };
  const results = await retrieveKnowledge(ctx.client, {
    tenantId: ctx.tenantId,
    query,
    topK: 4,
  });
  if (results.length === 0) {
    return {
      content:
        "No matching knowledge found. Do not invent an answer — tell the patient you'll have a team member follow up, or escalate if appropriate.",
      isError: false,
    };
  }
  const lines = results
    .map((r, i) => `[${i + 1}] ${r.content}${r.sourceUrl ? ` (src: ${r.sourceUrl})` : ""}`)
    .join("\n");
  return { content: lines, isError: false };
}

async function checkAvailability(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const serviceId = String(input.service_id ?? "");
  const fromIso = String(input.from_iso ?? "");
  const toIso = String(input.to_iso ?? "");
  if (!serviceId || !fromIso || !toIso)
    return {
      content: "service_id, from_iso, to_iso are all required",
      isError: true,
    };
  try {
    const slots = await ctx.bookingAdapter.checkAvailability({
      serviceId,
      from: fromIso,
      to: toIso,
      limit: 6,
    });
    if (slots.length === 0) {
      return {
        content:
          "No openings in that window. Suggest the patient try another date/time.",
        isError: false,
      };
    }
    return {
      content: JSON.stringify(
        slots.map((s) => ({ start: s.start, end: s.end })),
      ),
      isError: false,
    };
  } catch (err) {
    return { content: toolErrorMessage(err), isError: true };
  }
}

async function createBooking(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const serviceId = String(input.service_id ?? "");
  const startIso = String(input.start_iso ?? "");
  const contactName = String(input.contact_name ?? "").trim();
  if (!serviceId || !startIso || !contactName)
    return {
      content: "service_id, start_iso, contact_name required",
      isError: true,
    };
  const service = ctx.tenantConfig.services.find((s) => s.id === serviceId);
  if (!service)
    return { content: `unknown service_id: ${serviceId}`, isError: true };

  try {
    const result = await ctx.bookingAdapter.createBooking({
      serviceId,
      start: startIso,
      contactName,
      contactPhoneE164: ctx.contactPhoneE164,
      providerId: ctx.tenantConfig.booking.defaultProviderId,
      notes: "",
    });

    const phoneHash = hashPhone(ctx.contactPhoneE164, ctx.tenantId);
    await insertBooking(ctx.client, {
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      externalBookingId: result.externalBookingId,
      service: service.name,
      scheduledAt: result.confirmedStart,
      contactName,
      contactPhoneHash: phoneHash,
      estimatedValueCents: service.priceCents,
    });
    await updateConversationStatus(ctx.client, ctx.conversationId, "booked");
    await auditWithin(ctx.client, {
      tenantId: ctx.tenantId,
      actor: "agent",
      action: "booking_created",
      resourceType: "booking",
      metadata: {
        serviceId,
        startIso: result.confirmedStart,
        externalBookingId: result.externalBookingId,
      },
    });
    return {
      content: `BOOKING_CONFIRMED id=${result.externalBookingId} start=${result.confirmedStart} service=${service.name}`,
      isError: false,
      outcome: "booked",
    };
  } catch (err) {
    return { content: toolErrorMessage(err), isError: true };
  }
}

async function escalate(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const reason = String(input.reason ?? "manual");
  const summary = String(input.summary ?? "").slice(0, 280);
  await updateConversationStatus(ctx.client, ctx.conversationId, "escalated");
  await auditWithin(ctx.client, {
    tenantId: ctx.tenantId,
    actor: "agent",
    action: "conversation_escalated",
    resourceType: "conversation",
    resourceId: ctx.conversationId,
    metadata: { reason, summary },
  });
  await ctx.notifyOwner(summary, reason).catch(() => {
    // Owner notification must not fail the tool call — the escalation row is
    // already in the DB and the dashboard will surface it.
  });
  return {
    content: `ESCALATED reason=${reason}. Acknowledge the patient warmly and tell them a team member will follow up shortly.`,
    isError: false,
    outcome: "escalated",
  };
}

async function endConversation(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const outcome = String(input.outcome ?? "ended") as
    | "booked"
    | "abandoned"
    | "ended";
  const status =
    outcome === "booked"
      ? "booked"
      : outcome === "abandoned"
        ? "abandoned"
        : "active";
  if (status !== "active")
    await updateConversationStatus(ctx.client, ctx.conversationId, status);
  return {
    content: `CONVERSATION_ENDED outcome=${outcome}`,
    isError: false,
    outcome,
  };
}

function toolErrorMessage(err: unknown): string {
  const e = err as Partial<BookingAdapterError>;
  if (e && typeof e === "object" && "code" in e) {
    return `booking_error code=${e.code} message=${e.message ?? ""}`;
  }
  return `error: ${(err as Error)?.message ?? "unknown"}`;
}
