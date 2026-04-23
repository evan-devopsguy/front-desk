#!/usr/bin/env tsx
/**
 * CLI: simulate an inbound SMS conversation end-to-end. Use on sales calls
 * to show a realistic flow in ~90 seconds with no live Twilio setup.
 *
 * Runs against the seeded demo tenant (Aurora Med Spa) and prints each turn
 * with a short delay so it reads like a real exchange.
 *
 *   pnpm demo
 */
import { closePool, withTenant } from "../apps/api/src/db/client.js";
import {
  findOrCreateConversation,
  getTenant,
} from "../apps/api/src/db/repository.js";
import { orchestrate } from "../apps/api/src/agent/orchestrator.js";
import { createBookingAdapter } from "../apps/api/src/integrations/booking/index.js";
import { hashPhone } from "../apps/api/src/lib/phi.js";
import { seedEvalTenants } from "../packages/eval/src/seed.js";
import { TENANT_A } from "../packages/eval/src/scenarios.js";

const SCRIPT = [
  "Hey! I just moved to the neighborhood and I'd love to book a hydrafacial this week.",
  "The earliest one works great. Name is Jamie Rivera.",
  "Yes please, go ahead and confirm it.",
];

const PATIENT_PHONE = "+15551234567";

function pad(s: string, n = 12): string {
  return s.length >= n ? s : `${s}${" ".repeat(n - s.length)}`;
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("seeding demo tenant (Aurora Med Spa)...");
  await seedEvalTenants();

  const tenant = await withTenant(
    { tenantId: TENANT_A, actor: "demo" },
    (c) => getTenant(c, TENANT_A),
  );
  if (!tenant) throw new Error("demo tenant missing after seed");

  for (const patientText of SCRIPT) {
    console.log(`\n${pad("patient →")} ${patientText}`);
    await delay(700);

    const result = await withTenant(
      { tenantId: TENANT_A, actor: "demo" },
      async (client) => {
        const hash = hashPhone(PATIENT_PHONE, TENANT_A);
        const convo = await findOrCreateConversation(client, {
          tenantId: TENANT_A,
          channel: "sms",
          patientPhoneHash: hash,
        });
        const adapter = createBookingAdapter("mock", {
          tenantId: tenant.id,
          tenantConfig: tenant.config,
        });
        return orchestrate({
          client,
          tenant: { id: tenant.id, name: tenant.name, config: tenant.config },
          conversationId: convo.id,
          patientPhoneE164: PATIENT_PHONE,
          inboundText: patientText,
          bookingAdapter: adapter,
          notifyOwner: async () => {},
        });
      },
    );

    for (const line of result.replyText.split(/\n+/)) {
      await delay(400);
      console.log(`${pad("aurora →")} ${line}`);
    }
    if (result.outcome === "booked") {
      console.log(`\n✓ booking confirmed — demo complete`);
      break;
    }
  }

  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
