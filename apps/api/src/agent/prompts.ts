import type { Vertical } from "../verticals/types.js";
import type { TenantConfig } from "@medspa/shared";

const toneGuide: Record<string, string> = {
  warm: "Warm, conversational, reassuring. Short sentences. No corporate jargon.",
  professional: "Polished and concise. Avoid slang. Use complete sentences.",
  luxury: "Refined and understated. Avoid emojis. Treat the patient as a valued client.",
  friendly: "Casual and upbeat. First-name basis once known.",
};

/**
 * Build the system prompt by interpolating `{{token}}` placeholders in the
 * vertical's prompt template. Every substitution key comes from tenant config
 * so onboarding a new tenant is a config change, not a code change.
 */
export function buildSystemPrompt(args: {
  vertical: Vertical;
  tenant: { name: string; config: TenantConfig };
  nowIso: string;
}): string {
  const c = args.tenant.config;

  const services = c.services
    .map(
      (s) =>
        `- ${s.name} (id=${s.id}, ~${s.durationMinutes}min, $${(s.priceCents / 100).toFixed(0)}${
          s.requiresConsult ? ", requires consult" : ""
        }): ${s.description}`,
    )
    .join("\n");

  const hoursLine = Object.entries(c.hours)
    .map(([day, v]) => `${day}: ${v ? `${v.open}–${v.close}` : "closed"}`)
    .join(", ");

  const voiceToneText = toneGuide[c.voice.tone] ?? toneGuide["warm"] ?? "";
  const signOffLine = c.voice.signOff ? `Sign off with: "${c.voice.signOff}"` : "";

  return args.vertical.prompts.system
    .replaceAll("{{displayName}}", c.displayName)
    .replaceAll("{{maxSmsChars}}", String(c.voice.maxSmsChars))
    .replaceAll("{{timezone}}", c.timezone)
    .replaceAll("{{hours}}", hoursLine)
    .replaceAll("{{nowIso}}", args.nowIso)
    .replaceAll("{{minLeadTimeMinutes}}", String(c.booking.minLeadTimeMinutes))
    .replaceAll("{{maxAdvanceDays}}", String(c.booking.maxAdvanceDays))
    .replaceAll("{{services}}", services)
    .replaceAll("{{voiceTone}}", voiceToneText)
    .replaceAll("\n{{signOff}}", signOffLine ? `\n${signOffLine}` : "");
}

export function buildClassifierPrompt(args: { vertical: Vertical }): string {
  return args.vertical.prompts.classifier;
}
