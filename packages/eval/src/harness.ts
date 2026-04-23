import { withTenant } from "../../../apps/api/src/db/client.js";
import {
  findOrCreateConversation,
  getTenant,
} from "../../../apps/api/src/db/repository.js";
import { orchestrate } from "../../../apps/api/src/agent/orchestrator.js";
import { createBookingAdapter } from "../../../apps/api/src/integrations/booking/index.js";
import { __resetMockBookings, __listMockBookings } from "../../../apps/api/src/integrations/booking/mock.js";
import { hashPhone } from "../../../apps/api/src/lib/pii.js";
import type { OrchestrateOutput } from "../../../apps/api/src/agent/orchestrator.js";
import { getVertical } from "../../../apps/api/src/verticals/index.js";
import type { VerticalId } from "../../../apps/api/src/verticals/types.js";

export interface Turn {
  patient: string;
}

export interface Expectation {
  /** Intent the classifier must return on the first turn. */
  intent?:
    | "faq"
    | "booking"
    | "clinical"
    | "emergency"
    | "complaint"
    | "spam";
  /** Final conversation status. */
  status?: "active" | "booked" | "escalated" | "abandoned";
  /** Strings the reply MUST contain (case-insensitive). */
  mustContain?: string[];
  /** Strings the reply MUST NOT contain (case-insensitive). */
  mustNotContain?: string[];
  /** Number of bookings expected in the mock adapter by the end of the run. */
  bookingsCount?: number;
  /** If set, assert whether the notifyOwner callback was invoked this scenario. */
  notifyOwnerFired?: boolean;
}

export interface Scenario {
  id: string;
  description: string;
  vertical: VerticalId;   // must match the seeded tenant's vertical
  tenantId: string;
  patientPhone: string;
  turns: Turn[];
  expect: Expectation;
}

export interface ScenarioResult {
  id: string;
  pass: boolean;
  failures: string[];
  replies: string[];
  finalOutcome: OrchestrateOutput["outcome"] | null;
  intent: OrchestrateOutput["intent"] | null;
}

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  __resetMockBookings();
  const failures: string[] = [];
  const replies: string[] = [];
  let firstIntent: OrchestrateOutput["intent"] | null = null;
  let lastOutcome: OrchestrateOutput["outcome"] | null = null;

  const tenant = await withTenant(
    { tenantId: s.tenantId, actor: "eval" },
    (c) => getTenant(c, s.tenantId),
  );
  if (!tenant) {
    return {
      id: s.id,
      pass: false,
      failures: [`tenant not found: ${s.tenantId}`],
      replies: [],
      finalOutcome: null,
      intent: null,
    };
  }

  if (tenant.vertical !== s.vertical) {
    return {
      id: s.id, pass: false,
      failures: [`vertical mismatch: expected=${s.vertical} actual=${tenant.vertical}`],
      replies: [], finalOutcome: null, intent: null,
    };
  }

  let notifyOwnerCalled = false;

  for (const turn of s.turns) {
    const result = await withTenant(
      { tenantId: s.tenantId, actor: "eval" },
      async (client) => {
        const phoneHash = hashPhone(s.patientPhone, s.tenantId);
        const convo = await findOrCreateConversation(client, {
          tenantId: s.tenantId,
          channel: "sms",
          contactPhoneHash: phoneHash,
        });
        const adapter = createBookingAdapter(tenant.bookingAdapter, {
          tenantId: tenant.id,
          tenantConfig: tenant.config,
        });
        return orchestrate({
          client,
          tenant: { id: tenant.id, name: tenant.name, config: tenant.config },
          conversationId: convo.id,
          contactPhoneE164: s.patientPhone,
          inboundText: turn.patient,
          bookingAdapter: adapter,
          vertical: getVertical(tenant.vertical),
          notifyOwner: async () => { notifyOwnerCalled = true; },
        });
      },
    );
    if (!firstIntent) firstIntent = result.intent;
    lastOutcome = result.outcome;
    replies.push(result.replyText);
  }

  const fullReply = replies.join("\n").toLowerCase();

  if (s.expect.intent && firstIntent !== s.expect.intent) {
    failures.push(`intent expected=${s.expect.intent} actual=${firstIntent}`);
  }
  if (s.expect.status) {
    const expectedOutcome =
      s.expect.status === "booked"
        ? "booked"
        : s.expect.status === "escalated"
          ? "escalated"
          : s.expect.status === "abandoned"
            ? "abandoned"
            : "awaiting_patient";
    if (lastOutcome !== expectedOutcome) {
      failures.push(
        `status expected=${expectedOutcome} actual=${lastOutcome}`,
      );
    }
  }
  for (const s1 of s.expect.mustContain ?? []) {
    if (!fullReply.includes(s1.toLowerCase())) {
      failures.push(`reply missing expected string: "${s1}"`);
    }
  }
  for (const s1 of s.expect.mustNotContain ?? []) {
    if (fullReply.includes(s1.toLowerCase())) {
      failures.push(`reply contained forbidden string: "${s1}"`);
    }
  }

  if (s.expect.notifyOwnerFired !== undefined) {
    if (notifyOwnerCalled !== s.expect.notifyOwnerFired) {
      failures.push(
        `notifyOwner: expected fired=${s.expect.notifyOwnerFired} actual=${notifyOwnerCalled}`,
      );
    }
  }

  if (s.expect.bookingsCount !== undefined) {
    const bookings = __listMockBookings();
    if (bookings.length !== s.expect.bookingsCount) {
      failures.push(
        `bookingsCount: expected=${s.expect.bookingsCount} actual=${bookings.length}`,
      );
    }
  }

  return {
    id: s.id,
    pass: failures.length === 0,
    failures,
    replies,
    finalOutcome: lastOutcome,
    intent: firstIntent,
  };
}
