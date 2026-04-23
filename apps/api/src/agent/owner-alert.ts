import { z } from "zod";

export const notifyOwnerInputSchema = z.object({
  urgency: z.enum(["emergency", "complaint", "fyi"]),
  summary: z.string().min(1).max(160),
  callbackPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  address: z.string().optional(),
});

export type NotifyOwnerInput = z.infer<typeof notifyOwnerInputSchema>;

export interface OwnerAlertContext {
  tenantName: string;
  urgency: NotifyOwnerInput["urgency"];
  summary: string;
  callbackPhone: string;
  address?: string;
  slaMinutes?: number;
}

/**
 * Render the SMS body the owner receives. Pure — no side effects, unit-testable.
 *
 * Templates (from spec):
 *   emergency: 🚨 URGENT — {summary}. Callback: {callbackPhone}. Address: {address}. SLA {slaMinutes}min.
 *   complaint: Callback needed — {summary}. From: {callbackPhone}. Address: {address}.
 *   fyi:       FYI: {summary}.
 *
 * `address` and `slaMinutes` are dropped from templates when undefined.
 */
export function buildOwnerAlertBody(ctx: OwnerAlertContext): string {
  const addr = ctx.address ? ` Address: ${ctx.address}.` : "";
  const sla = ctx.slaMinutes ? ` SLA ${ctx.slaMinutes}min.` : "";
  switch (ctx.urgency) {
    case "emergency":
      return `🚨 URGENT — ${ctx.summary}. Callback: ${ctx.callbackPhone}.${addr}${sla}`;
    case "complaint":
      return `Callback needed — ${ctx.summary}. From: ${ctx.callbackPhone}.${addr}`;
    case "fyi":
      return `FYI: ${ctx.summary}.`;
  }
}
