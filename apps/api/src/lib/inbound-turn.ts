import { unscoped, withTenant } from "../db/client.js";
import {
  findOrCreateConversation,
  findTenantByPhone,
  type TenantRow,
} from "../db/repository.js";
import { orchestrate } from "../agent/orchestrator.js";
import { createBookingAdapter } from "../integrations/booking/index.js";
import { getVertical } from "../verticals/index.js";
import { sendSms } from "../integrations/twilio.js";
import { audit } from "./audit.js";
import { logger } from "./logger.js";
import { hashPhone } from "./pii.js";
import type { Channel } from "@medspa/shared";

export interface InboundTurnInput {
  /** Tenant's Twilio number — the `To` on the inbound webhook. */
  toNumber: string;
  /** Caller's number — the `From` on the inbound webhook. */
  fromNumber: string;
  /** The patient's text for this turn. For voice, the completed transcript. */
  inboundText: string;
  channel: Channel;
}

export interface InboundTurnResult {
  tenant: TenantRow;
  replyText: string;
  intent: string;
  outcome: string;
}

/**
 * Runs one inbound patient turn end-to-end. Shared by the SMS webhook and the
 * voice-transcription webhook so the agent code path is identical regardless
 * of channel.
 *
 *   1. Resolve tenant by Twilio number.
 *   2. Open tenant-scoped transaction (RLS applies).
 *   3. Find/create active conversation for (tenant, contact_phone_hash).
 *   4. Run orchestrator.
 *   5. Send the reply SMS to the caller.
 *
 * Returns null when the inbound number is not registered to any tenant.
 */
export async function handleInboundTurn(
  input: InboundTurnInput,
): Promise<InboundTurnResult | null> {
  const tenant = await unscoped((c) => findTenantByPhone(c, input.toNumber));
  if (!tenant) {
    logger.warn(
      { toNumber: input.toNumber, channel: input.channel },
      "inbound for unknown tenant number",
    );
    await audit({
      tenantId: null,
      actor: "twilio",
      action: "inbound_unknown_number",
      metadata: { to: input.toNumber, channel: input.channel },
    });
    return null;
  }

  const vertical = getVertical(tenant.vertical);

  const result = await withTenant(
    { tenantId: tenant.id, actor: "twilio" },
    async (client) => {
      const phoneHash = hashPhone(input.fromNumber, tenant.id);
      const convo = await findOrCreateConversation(client, {
        tenantId: tenant.id,
        channel: input.channel,
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
        contactPhoneE164: input.fromNumber,
        inboundText: input.inboundText,
        bookingAdapter: adapter,
        vertical,
        notifyOwner: async (summary, reasonCode, preFormatted) => {
          const ownerPhone = tenant.config.escalation.ownerPhoneE164;
          const smsBody = preFormatted
            ? summary
            : `[${tenant.name}] ${reasonCode.toUpperCase()}: ${summary}`;
          try {
            await sendSms({
              from: tenant.twilioNumber,
              to: ownerPhone,
              body: smsBody,
            });
          } catch (err) {
            logger.error({ err }, "owner notify failed");
          }
        },
      });
    },
  );

  try {
    await sendSms({
      from: tenant.twilioNumber,
      to: input.fromNumber,
      body: result.replyText,
    });
  } catch (err) {
    logger.error({ err }, "twilio outbound send failed");
  }

  await audit({
    tenantId: tenant.id,
    actor: "agent",
    action: "message_sent",
    resourceType: "conversation",
    metadata: {
      intent: result.intent,
      outcome: result.outcome,
      channel: input.channel,
    },
  });

  return {
    tenant,
    replyText: result.replyText,
    intent: result.intent,
    outcome: result.outcome,
  };
}
