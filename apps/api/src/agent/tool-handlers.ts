import { retrieveKnowledge } from "../rag/retrieve.js";
import {
  insertBooking,
  updateConversationStatus,
} from "../db/repository.js";
import { auditWithin } from "../lib/audit.js";
import { hashPhone, redact } from "../lib/pii.js";
import type { BookingAdapterError } from "../integrations/booking/types.js";
import {
  notifyOwnerInputSchema,
  buildOwnerAlertBody,
} from "./owner-alert.js";
import type { ToolContext, ToolOutput } from "./tools.js";

export async function searchKnowledge(
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
        "No matching knowledge found. Do not invent an answer — tell the caller you'll have someone follow up, or escalate if appropriate.",
      isError: false,
    };
  }
  const lines = results
    .map((r, i) => `[${i + 1}] ${r.content}${r.sourceUrl ? ` (src: ${r.sourceUrl})` : ""}`)
    .join("\n");
  return { content: lines, isError: false };
}

export async function checkAvailability(
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
          "No openings in that window. Suggest the caller try another date/time.",
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

export async function createBooking(
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

  const address = typeof input.address === "string" ? input.address : undefined;
  const problemDescription = typeof input.problem_description === "string" ? input.problem_description : undefined;

  try {
    const result = await ctx.bookingAdapter.createBooking({
      serviceId,
      start: startIso,
      contactName,
      contactPhoneE164: ctx.contactPhoneE164,
      providerId: ctx.tenantConfig.booking.defaultProviderId,
      notes: "",
      address,
      problemDescription,
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

export async function escalate(
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
    // already in the DB and is queryable from audit_log.
  });
  return {
    content: `ESCALATED reason=${reason}. Acknowledge the caller warmly and tell them a team member will follow up shortly.`,
    isError: false,
    outcome: "escalated",
  };
}

export async function notifyOwnerTool(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const parsed = notifyOwnerInputSchema.parse(input);
  const body = buildOwnerAlertBody({
    tenantName: ctx.tenantConfig.displayName,
    urgency: parsed.urgency,
    summary: parsed.summary,
    callbackPhone: parsed.callbackPhone,
    address: parsed.address,
    slaMinutes: ctx.tenantConfig.escalation.slaMinutesByUrgency?.[parsed.urgency],
  });
  await ctx.notifyOwner(body, parsed.urgency, true).catch(() => {});
  await auditWithin(ctx.client, {
    tenantId: ctx.tenantId,
    actor: "agent",
    action: "notify_owner",
    resourceType: "conversation",
    resourceId: ctx.conversationId,
    metadata: {
      urgency: parsed.urgency,
      summary: redact(parsed.summary) as string,
    },
  });
  if (parsed.urgency !== "fyi") {
    await updateConversationStatus(ctx.client, ctx.conversationId, "escalated");
  }
  return {
    content: `OWNER_PAGED urgency=${parsed.urgency}. Acknowledge the caller and tell them the owner will call back shortly.`,
    isError: false,
    outcome: parsed.urgency === "fyi" ? undefined : "escalated",
  };
}

export async function endConversation(
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
