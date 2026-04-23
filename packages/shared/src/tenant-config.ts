import { z } from "zod";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const weekday = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

export const hoursSchema = z.record(
  weekday,
  z
    .object({
      open: z.string().regex(HHMM),
      close: z.string().regex(HHMM),
    })
    .nullable(),
);

export const serviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  durationMinutes: z.number().int().positive(),
  priceCents: z.number().int().nonnegative(),
  providerTags: z.array(z.string()).default([]),
  requiresConsult: z.boolean().default(false),
});

export const escalationRuleSchema = z.object({
  ownerPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  escalateOn: z
    .array(z.enum(["clinical", "complaint", "after-hours", "spam", "manual"]))
    .default(["clinical", "complaint", "manual"]),
  quietHours: z
    .object({
      start: z.string().regex(HHMM),
      end: z.string().regex(HHMM),
    })
    .nullable()
    .default(null),
});

export const tenantConfigSchema = z.object({
  displayName: z.string(),
  timezone: z.string().default("America/New_York"),
  hours: hoursSchema,
  services: z.array(serviceSchema).min(1),
  voice: z
    .object({
      tone: z
        .enum(["warm", "professional", "luxury", "friendly"])
        .default("warm"),
      signOff: z.string().default(""),
      maxSmsChars: z.number().int().positive().default(320),
      /** Optional override for the voicemail greeting. If unset, a default
       *  built from the spa's display name is used. */
      voicemailGreeting: z.string().optional(),
    })
    .default({ tone: "warm", signOff: "", maxSmsChars: 320 }),
  escalation: escalationRuleSchema,
  booking: z
    .object({
      minLeadTimeMinutes: z.number().int().nonnegative().default(120),
      maxAdvanceDays: z.number().int().positive().default(60),
      defaultProviderId: z.string().nullable().default(null),
    })
    .default({
      minLeadTimeMinutes: 120,
      maxAdvanceDays: 60,
      defaultProviderId: null,
    }),
  knowledgeSources: z.array(z.string().url()).default([]),
});

export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Hours = z.infer<typeof hoursSchema>;
export type EscalationRule = z.infer<typeof escalationRuleSchema>;
export type Weekday = z.infer<typeof weekday>;
