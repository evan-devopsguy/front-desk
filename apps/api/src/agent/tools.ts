import type { AnthropicTool } from "../integrations/bedrock.js";
import type {
  BookingAdapter,
} from "../integrations/booking/types.js";
import type { TenantConfig } from "@medspa/shared";
import type { ToolId } from "../verticals/types.js";
import type { PoolClient } from "pg";
import {
  searchKnowledge,
  checkAvailability,
  createBooking,
  escalate,
  endConversation,
  notifyOwnerTool,
} from "./tool-handlers.js";

export const TOOL_DEFINITIONS: AnthropicTool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the business's knowledge base (services, policies, pricing, FAQs). Use for every factual claim callers ask about.",
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
      "Check open appointment slots for a given service between two ISO datetimes. Use BEFORE proposing times to the caller.",
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
        address: {
          type: "string",
          description: "Service address (required for garage-doors bookings).",
        },
        problem_description: {
          type: "string",
          description: "One-sentence problem description (e.g., 'broken torsion spring').",
        },
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
      "End the conversation. Use when the caller says goodbye, confirmed a booking, or the thread is clearly done.",
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
  {
    name: "notify_owner",
    description:
      "Page the business owner via SMS. Use for emergencies (stuck door, safety hazard, car trapped), complaints about prior work, or informational heads-up (out-of-area caller). Always call this BEFORE end_conversation when the classifier flagged the intent as an always-escalate category.",
    input_schema: {
      type: "object",
      properties: {
        urgency: { type: "string", enum: ["emergency", "complaint", "fyi"] },
        summary: {
          type: "string",
          description: "One sentence, ≤160 chars. Enough for the owner to decide how fast to call back.",
        },
        callbackPhone: {
          type: "string",
          description: "E.164 callback number for the caller.",
        },
        address: { type: "string", description: "Street address (required for emergency, optional otherwise)." },
      },
      required: ["urgency", "summary", "callbackPhone"],
    },
  },
];

export function getToolDefinitions(ids: ReadonlyArray<ToolId>): AnthropicTool[] {
  const set = new Set<string>(ids);
  return TOOL_DEFINITIONS.filter((t) => set.has(t.name));
}

export interface ToolContext {
  client: PoolClient;
  tenantId: string;
  tenantConfig: TenantConfig;
  conversationId: string;
  contactPhoneE164: string;
  bookingAdapter: BookingAdapter;
  /** Used for SMS owner notifications on escalation. */
  notifyOwner: (summary: string, reason: string, preFormatted?: boolean) => Promise<void>;
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
    case "notify_owner":
      return notifyOwnerTool(ctx, input);
    default:
      return { content: `unknown tool: ${name}`, isError: true };
  }
}
