#!/usr/bin/env tsx
/**
 * CLI: onboard a new tenant from a public URL.
 *
 * Usage:
 *   pnpm db:seed -- \
 *     --vertical  garage-doors \
 *     --name      "Fix Garage" \
 *     --twilio    "+15555550001" \
 *     --owner-phone "+15555550100" \
 *     --adapter   google-calendar \
 *     --timezone  "America/Phoenix" \
 *     --url       "https://fixgarage.example.com"
 *
 * Steps:
 *   1. Parse args + load tenant config template.
 *   2. Insert/upsert the tenant row with a sensible config.
 *   3. Call ingestUrls to scrape → chunk → embed the site.
 *
 * The config written here is editable later via direct DB update or re-seed.
 * This script is the 80% path; ONBOARDING.md describes the remaining 20%.
 */
import { unscoped } from "../apps/api/src/db/client.js";
import { ingestUrls } from "../apps/api/src/rag/ingest.js";
import { closePool } from "../apps/api/src/db/client.js";
import { tenantConfigSchema, type TenantConfig } from "@medspa/shared";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

function defaultConfig(displayName: string, ownerPhone: string): TenantConfig {
  return tenantConfigSchema.parse({
    displayName,
    timezone: "America/New_York",
    hours: {
      mon: { open: "09:00", close: "18:00" },
      tue: { open: "09:00", close: "18:00" },
      wed: { open: "09:00", close: "18:00" },
      thu: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "18:00" },
      sat: { open: "10:00", close: "16:00" },
      sun: null,
    },
    services: [
      {
        id: "consult",
        name: "New patient consult",
        description:
          "A 20-minute meet-the-provider consult for first-time patients.",
        durationMinutes: 20,
        priceCents: 0,
        providerTags: [],
        requiresConsult: false,
      },
    ],
    voice: { tone: "warm", signOff: `— ${displayName}`, maxSmsChars: 320 },
    escalation: {
      ownerPhoneE164: ownerPhone,
      escalateOn: ["clinical", "complaint", "manual"],
      quietHours: { start: "22:00", end: "08:00" },
    },
    booking: {
      minLeadTimeMinutes: 120,
      maxAdvanceDays: 60,
      defaultProviderId: null,
    },
    knowledgeSources: [],
  });
}

function garageDoorsDefaultConfig(args: {
  name: string;
  ownerPhone: string;
  timezone: string;
}): TenantConfig {
  return tenantConfigSchema.parse({
    displayName: args.name,
    timezone: args.timezone,
    hours: {
      mon: { open: "08:00", close: "18:00" },
      tue: { open: "08:00", close: "18:00" },
      wed: { open: "08:00", close: "18:00" },
      thu: { open: "08:00", close: "18:00" },
      fri: { open: "08:00", close: "18:00" },
      sat: { open: "09:00", close: "15:00" },
      sun: null,
    },
    services: [{
      id: "service_call",
      name: "Service call",
      description: "Diagnosis + on-site repair, typically 60 min.",
      durationMinutes: 60,
      priceCents: 0,
      providerTags: [],
      requiresConsult: false,
    }],
    voice: {
      tone: "friendly",
      signOff: `— ${args.name}`,
      maxSmsChars: 320,
      forwardBeforeVoicemail: { enabled: true, timeoutSeconds: 18 },
    },
    escalation: {
      ownerPhoneE164: args.ownerPhone,
      escalateOn: ["complaint", "manual"],
      quietHours: null,
      slaMinutesByUrgency: { emergency: 15, complaint: 240, fyi: 1440 },
    },
    booking: {
      minLeadTimeMinutes: 60,
      maxAdvanceDays: 30,
      defaultProviderId: null,
    },
    knowledgeSources: [],
    serviceAreaZips: [],
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vertical = (args.vertical ?? "medspa") as "medspa" | "garage-doors";
  const name = args.name ?? (vertical === "garage-doors" ? "Fix Garage" : "Aurora Med Spa");
  const twilio = args.twilio ?? "+15555550001";
  const ownerPhone = args["owner-phone"] ?? args.owner ?? "+15555550100";
  const timezone = args.timezone ?? (vertical === "garage-doors" ? "America/Phoenix" : "America/New_York");
  const adapter = (args.adapter ?? (vertical === "garage-doors" ? "google-calendar" : "mock")) as
    "mock" | "boulevard" | "vagaro" | "google-calendar";
  const secretArn = args["secret-arn"] ?? null;
  const url = args.url ?? null;

  // Production safety guard
  if (process.env["NODE_ENV"] === "production") {
    const confirm = args.confirm;
    if (confirm !== twilio) {
      console.error(
        `Production safety: pass --confirm ${twilio} to confirm you intend to seed/overwrite this number.`,
      );
      process.exit(1);
    }
  }

  const config = vertical === "garage-doors"
    ? garageDoorsDefaultConfig({ name, ownerPhone, timezone })
    : defaultConfig(name, ownerPhone);

  if (url) config.knowledgeSources = [url];

  const tenantId: string = await unscoped(async (c) => {
    const res = await c.query(
      `INSERT INTO tenants (name, twilio_number, vertical, booking_adapter, booking_credentials_secret_arn, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (twilio_number) DO UPDATE SET
         name = EXCLUDED.name,
         vertical = EXCLUDED.vertical,
         booking_adapter = EXCLUDED.booking_adapter,
         booking_credentials_secret_arn = EXCLUDED.booking_credentials_secret_arn,
         config = EXCLUDED.config
       RETURNING id`,
      [name, twilio, vertical, adapter, secretArn, config],
    );
    return res.rows[0].id as string;
  });

  console.log(`tenant ready: ${name} [${vertical}] adapter=${adapter} (${tenantId})`);

  if (url) {
    console.log(`ingesting knowledge base from ${url}...`);
    const out = await ingestUrls({ tenantId, urls: [url], actor: "seed-script" });
    console.log(`  indexed ${out.chunks} chunks from ${out.urls} urls`);
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
