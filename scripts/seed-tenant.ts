#!/usr/bin/env tsx
/**
 * CLI: onboard a new spa from a public URL.
 *
 * Usage:
 *   pnpm db:seed -- \
 *     --name "Aurora Med Spa" \
 *     --twilio "+15555550001" \
 *     --url   "https://auroramedspa.example.com"
 *
 * Steps:
 *   1. Parse args + load tenant config template.
 *   2. Insert/upsert the tenant row with a sensible config.
 *   3. Call ingestUrls to scrape → chunk → embed the site.
 *
 * The config written here is intentionally editable in the dashboard later.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const name = args.name ?? "Aurora Med Spa";
  const twilio = args.twilio ?? "+15555550001";
  const url = args.url;
  const ownerPhone = args.owner ?? "+15555550100";

  const config = defaultConfig(name, ownerPhone);
  if (url) config.knowledgeSources = [url];

  const tenantId: string = await unscoped(async (c) => {
    const res = await c.query(
      `INSERT INTO tenants (name, twilio_number, booking_adapter, config)
       VALUES ($1, $2, 'mock', $3)
       ON CONFLICT (twilio_number) DO UPDATE SET
         name = EXCLUDED.name, config = EXCLUDED.config
       RETURNING id`,
      [name, twilio, config],
    );
    return res.rows[0].id as string;
  });

  console.log(`tenant ready: ${name} (${tenantId})`);

  if (url) {
    console.log(`ingesting knowledge base from ${url}...`);
    const out = await ingestUrls({
      tenantId,
      urls: [url],
      actor: "seed-script",
    });
    console.log(`  indexed ${out.chunks} chunks from ${out.urls} urls`);
  } else {
    console.log("no --url provided, skipping RAG ingest");
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
