import type { Intent } from "@medspa/shared";

export type VerticalId = "medspa" | "garage-doors";

export type ToolId =
  | "search_knowledge"
  | "check_availability"
  | "create_booking"
  | "escalate_to_human"
  | "notify_owner"
  | "end_conversation";

export type BookingAdapterId = "mock" | "boulevard" | "vagaro" | "google-calendar";

export interface Vertical {
  id: VerticalId;
  prompts: {
    /**
     * System prompt template. In Phase 2a this may be empty for a given
     * vertical if the legacy `buildSystemPrompt` in `agent/prompts.ts` still
     * owns the template; Phase 2d migrates the template string here and
     * rewires the builder to interpolate whichever vertical's string is
     * passed in.
     */
    system: string;
    classifier: string;
  };
  classifier: { categories: ReadonlyArray<Intent> };
  escalation: {
    /** Intents that MUST trigger an escalation tool call before end_conversation. */
    alwaysEscalateCategories: ReadonlyArray<Intent>;
    /** The tool the agent calls to escalate. */
    escalationTool: Extract<ToolId, "escalate_to_human" | "notify_owner">;
    /** Vertical-specific SLA map (minutes), used by the escalation tool body. */
    slaMinutesByUrgency?: Record<string, number>;
  };
  tools: ReadonlyArray<ToolId>;
  bookingAdapters: ReadonlyArray<BookingAdapterId>;
  compliance: { level: "hipaa" | "standard"; baaRequired: boolean };
}
