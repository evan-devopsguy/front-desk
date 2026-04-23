import { unscoped, withTenant } from "../../../apps/api/src/db/client.js";
import { auditWithin } from "../../../apps/api/src/lib/audit.js";
import { tenantConfigSchema, type TenantConfig } from "@medspa/shared";
import { TENANT_A, TENANT_B, TENANT_C } from "./scenarios.js";

export const AURORA_CONFIG: TenantConfig = tenantConfigSchema.parse({
  displayName: "Aurora Med Spa",
  timezone: "America/New_York",
  hours: {
    mon: { open: "09:00", close: "19:00" },
    tue: { open: "09:00", close: "19:00" },
    wed: { open: "09:00", close: "19:00" },
    thu: { open: "09:00", close: "19:00" },
    fri: { open: "09:00", close: "19:00" },
    sat: { open: "10:00", close: "16:00" },
    sun: null,
  },
  services: [
    {
      id: "hydrafacial",
      name: "HydraFacial",
      description:
        "A 60-minute hydrating facial that cleanses, exfoliates, and infuses the skin with serums.",
      durationMinutes: 60,
      priceCents: 22500,
      providerTags: ["esthetician"],
      requiresConsult: false,
    },
    {
      id: "botox",
      name: "Botox (per area)",
      description:
        "Injectable treatment for dynamic wrinkles, delivered by a licensed nurse practitioner.",
      durationMinutes: 30,
      priceCents: 35000,
      providerTags: ["np"],
      requiresConsult: true,
    },
    {
      id: "laser-hair",
      name: "Laser Hair Removal — single area",
      description: "Single-area laser hair removal session.",
      durationMinutes: 30,
      priceCents: 15000,
      providerTags: ["laser-tech"],
      requiresConsult: false,
    },
  ],
  voice: {
    tone: "warm",
    signOff: "— Aurora Med Spa",
    maxSmsChars: 320,
  },
  escalation: {
    ownerPhoneE164: "+15555550100",
    escalateOn: ["clinical", "complaint", "manual"],
    quietHours: { start: "22:00", end: "08:00" },
  },
  booking: {
    minLeadTimeMinutes: 120,
    maxAdvanceDays: 45,
    defaultProviderId: null,
  },
  knowledgeSources: [],
});

export const RIVERBEND_CONFIG: TenantConfig = tenantConfigSchema.parse({
  displayName: "Riverbend Aesthetic",
  timezone: "America/Chicago",
  hours: {
    mon: { open: "10:00", close: "18:00" },
    tue: { open: "10:00", close: "18:00" },
    wed: { open: "10:00", close: "18:00" },
    thu: { open: "10:00", close: "20:00" },
    fri: { open: "10:00", close: "18:00" },
    sat: null,
    sun: null,
  },
  services: [
    {
      id: "microneedling",
      name: "Microneedling",
      description: "45-minute collagen induction treatment.",
      durationMinutes: 45,
      priceCents: 27500,
      providerTags: ["esthetician"],
      requiresConsult: true,
    },
  ],
  voice: { tone: "professional", signOff: "— Riverbend", maxSmsChars: 320 },
  escalation: {
    ownerPhoneE164: "+15555550200",
    escalateOn: ["clinical", "complaint", "manual"],
    quietHours: null,
  },
  booking: {
    minLeadTimeMinutes: 240,
    maxAdvanceDays: 60,
    defaultProviderId: null,
  },
  knowledgeSources: [],
});

export const FIX_GARAGE_CONFIG: TenantConfig = tenantConfigSchema.parse({
  displayName: "Fix Garage",
  timezone: "America/Phoenix",
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
    signOff: "— Fix Garage",
    maxSmsChars: 320,
  },
  escalation: {
    ownerPhoneE164: "+15558880100",
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
  serviceAreaZips: ["85301", "85302", "85303"],
});

/**
 * Seed with the same word-hash embedding the MOCK_BEDROCK path uses, so the
 * eval's query embedding and the seeded chunk embeddings are in the same
 * space. Otherwise retrieval becomes noise and every FAQ scenario flakes.
 */
import { wordHashEmbedding } from "../../../apps/api/src/integrations/bedrock-mock.js";
const fakeEmbedding = wordHashEmbedding;

function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

export async function seedEvalTenants(): Promise<void> {
  await unscoped(async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, twilio_number, vertical, booking_adapter, config)
       VALUES ($1, $2, $3, 'medspa', 'mock', $4)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             twilio_number = EXCLUDED.twilio_number,
             vertical = EXCLUDED.vertical,
             config = EXCLUDED.config`,
      [TENANT_A, "Aurora Med Spa", "+15555550001", AURORA_CONFIG],
    );
    await client.query(
      `INSERT INTO tenants (id, name, twilio_number, vertical, booking_adapter, config)
       VALUES ($1, $2, $3, 'medspa', 'mock', $4)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             twilio_number = EXCLUDED.twilio_number,
             vertical = EXCLUDED.vertical,
             config = EXCLUDED.config`,
      [TENANT_B, "Riverbend Aesthetic", "+15555550002", RIVERBEND_CONFIG],
    );
    await client.query(
      `INSERT INTO tenants (id, name, twilio_number, vertical, booking_adapter, config)
       VALUES ($1, $2, $3, 'garage-doors', 'mock', $4)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             twilio_number = EXCLUDED.twilio_number,
             vertical = EXCLUDED.vertical,
             config = EXCLUDED.config`,
      [TENANT_C, "Fix Garage", "+15558880001", FIX_GARAGE_CONFIG],
    );
  });

  const auroraChunks = [
    `HydraFacial at Aurora is $225 for a 60-minute session. It includes cleansing, exfoliation, extractions, and a custom serum infusion.`,
    `Botox at Aurora is $350 per area, administered by a licensed nurse practitioner. A brief consult is required before first treatment.`,
    `Laser hair removal at Aurora starts at $150 per single area. Most patients see results in 4–6 sessions.`,
    `Cancellation policy: 24 hours' notice is required to avoid a $50 late-cancel fee. Reschedules are free with 24h notice.`,
    `Aurora Med Spa is open Monday–Friday 9am–7pm and Saturday 10am–4pm. We are closed on Sundays.`,
    `We are located at 100 Glow Avenue, Brooklyn NY. Parking is free on-site.`,
    `The Aurora Signature Glow is our most popular treatment package — a HydraFacial plus LED light therapy.`,
  ];
  const riverbendChunks = [
    `Microneedling at Riverbend is $275 for a 45-minute session. Topical numbing is included.`,
    `Riverbend Aesthetic is open Mon–Wed and Fri 10am–6pm, Thursday 10am–8pm. Weekends are closed.`,
    `New patients receive a complimentary 15-minute consult before their first treatment.`,
  ];

  await withTenant({ tenantId: TENANT_A, actor: "seed" }, async (c) => {
    await c.query(`DELETE FROM knowledge_chunks WHERE tenant_id = $1`, [
      TENANT_A,
    ]);
    for (const text of auroraChunks) {
      await c.query(
        `INSERT INTO knowledge_chunks (tenant_id, content, embedding, source_url)
         VALUES ($1, $2, $3::vector, $4)`,
        [TENANT_A, text, toPgVector(fakeEmbedding(text)), "eval://seeded"],
      );
    }
    await auditWithin(c, {
      tenantId: TENANT_A,
      actor: "seed",
      action: "knowledge_ingested",
      metadata: { chunks: auroraChunks.length },
    });
  });

  await withTenant({ tenantId: TENANT_B, actor: "seed" }, async (c) => {
    await c.query(`DELETE FROM knowledge_chunks WHERE tenant_id = $1`, [
      TENANT_B,
    ]);
    for (const text of riverbendChunks) {
      await c.query(
        `INSERT INTO knowledge_chunks (tenant_id, content, embedding, source_url)
         VALUES ($1, $2, $3::vector, $4)`,
        [TENANT_B, text, toPgVector(fakeEmbedding(text)), "eval://seeded"],
      );
    }
  });

  const fixGarageChunks = [
    `Fix Garage services the 85301, 85302, and 85303 zip codes in Phoenix. Out-of-area calls are flagged to the owner.`,
    `Broken spring repair typically runs $150–$250 for a standard residential spring. Commercial doors or specialty springs may cost more. We'd want to see it to give a firm quote.`,
    `Garage door opener installation or replacement typically runs $200–$400 including the unit. We carry several brands.`,
    `Fix Garage is open Monday–Friday 8am–6pm and Saturday 9am–3pm. Closed Sundays. Emergency calls are handled 24/7 by the owner.`,
    `A typical service call takes about an hour. We diagnose and repair most issues same visit. If parts are needed, we'll quote and return.`,
  ];

  await withTenant({ tenantId: TENANT_C, actor: "seed" }, async (c) => {
    await c.query(`DELETE FROM knowledge_chunks WHERE tenant_id = $1`, [
      TENANT_C,
    ]);
    for (const text of fixGarageChunks) {
      await c.query(
        `INSERT INTO knowledge_chunks (tenant_id, content, embedding, source_url)
         VALUES ($1, $2, $3::vector, $4)`,
        [TENANT_C, text, toPgVector(fakeEmbedding(text)), "eval://seeded"],
      );
    }
    await auditWithin(c, {
      tenantId: TENANT_C,
      actor: "seed",
      action: "knowledge_ingested",
      metadata: { chunks: fixGarageChunks.length },
    });
  });
}
