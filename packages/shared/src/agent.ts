import { z } from "zod";

export const intentSchema = z.enum([
  "faq",
  "booking",
  "clinical",
  "emergency", // garage-doors vertical only; orchestrator wiring in Phase 2
  "complaint",
  "spam",
]);
export type Intent = z.infer<typeof intentSchema>;

export const agentOutcomeSchema = z.enum([
  "awaiting_contact",
  "booked",
  "escalated",
  "abandoned",
  "ended",
]);
export type AgentOutcome = z.infer<typeof agentOutcomeSchema>;

export const toolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const toolResultSchema = z.object({
  name: z.string(),
  output: z.unknown(),
  isError: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof toolResultSchema>;
