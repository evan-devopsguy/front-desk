import type { FastifyPluginAsync } from "fastify";
import twilio from "twilio";
import { unscoped } from "../db/client.js";
import { findTenantByPhone } from "../db/repository.js";
import { sendSms, validateTwilioSignature } from "../integrations/twilio.js";
import { audit } from "../lib/audit.js";
import { getConfig } from "../lib/config.js";
import { handleInboundTurn } from "../lib/inbound-turn.js";
import { logger } from "../lib/logger.js";

/**
 * Voice pipeline. One of two shapes runs per inbound call, depending on
 * tenant config:
 *
 *   A. voicemail-only (default)
 *      POST /twilio/voice  → greeting + <Record> with transcribe
 *
 *   B. ring-owner-then-voicemail (forwardBeforeVoicemail.enabled)
 *      POST /twilio/voice            → <Dial> owner cell with action fallback
 *      POST /twilio/voice/no-answer  → fired only when the dial didn't
 *                                       complete; returns voicemail TwiML
 *
 *   Both shapes terminate at:
 *      POST /twilio/voice/transcription  → transcript → agent → SMS reply
 *
 * We never answer the call live. A missed phone call becomes an asynchronous
 * SMS conversation, reusing 100% of the SMS orchestrator — no second code
 * path for tools or prompts.
 */

const FALLBACK_SMS =
  "Hi — thanks for calling. We couldn't quite make out your voicemail. Please reply to this text and we'll help you from here.";

/**
 * Build the voicemail greeting. A tenant may override via config; otherwise we
 * generate a sensible default from the business name.
 */
export function buildGreeting(
  tenantName: string,
  override: string | null | undefined,
): string {
  if (override && override.trim().length > 0) return override.trim();
  return `Hi, thanks for calling ${tenantName}. We can't take your call right now, but if you leave a short message after the beep we'll text you right back.`;
}

/**
 * TwiML: play greeting, record, kick off transcription. This is the path
 * every call eventually reaches — either directly (voicemail-only tenants)
 * or via the no-answer action callback (forwarding tenants).
 */
export function buildVoicemailTwiml(args: {
  tenantName: string;
  voicemailGreeting: string | null;
  transcribeCallbackUrl: string;
}): string {
  const twiml = new twilio.twiml.VoiceResponse();
  const greeting = buildGreeting(args.tenantName, args.voicemailGreeting);
  twiml.say({ voice: "alice" }, greeting);
  twiml.record({
    maxLength: 90,
    timeout: 3,
    playBeep: true,
    trim: "trim-silence",
    transcribe: true,
    transcribeCallback: args.transcribeCallbackUrl,
  });
  twiml.say("Thanks — we'll text you back shortly.");
  twiml.hangup();
  return twiml.toString();
}

/**
 * TwiML: ring the owner's cell with callerId set to the tenant's Twilio
 * number. Owners save that number as a contact once, so forwarded calls
 * always ring through regardless of "silence unknown callers" filters on
 * their phone. answerOnBridge=true means the caller hears ringing (not
 * hold music) and the call is only billed/answered once the owner picks up.
 */
export function buildForwardTwiml(args: {
  twilioNumber: string;
  ownerPhoneE164: string;
  timeoutSeconds: number;
  actionUrl: string;
}): string {
  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial({
    callerId: args.twilioNumber,
    timeout: args.timeoutSeconds,
    action: args.actionUrl,
    method: "POST",
    answerOnBridge: true,
  });
  dial.number(args.ownerPhoneE164);
  return twiml.toString();
}

/** TwiML: the dial completed (owner answered & hung up). Nothing more to do. */
export function buildCompletedTwiml(): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.hangup();
  return twiml.toString();
}

/** TwiML for numbers we've never seen (shouldn't happen in practice). */
function buildUnknownNumberTwiml(): string {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say("Sorry, this number is not in service.");
  twiml.hangup();
  return twiml.toString();
}

/**
 * DialCallStatus values that mean "owner did NOT take the call". On any of
 * these, we fall through to the voicemail flow. "completed" means the leg
 * connected and ended normally — call is done, just hang up.
 *
 * Ref: https://www.twilio.com/docs/voice/twiml/dial#attributes-action
 */
const NO_ANSWER_STATUSES = new Set(["no-answer", "busy", "failed", "canceled"]);

export const twilioVoiceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/twilio/voice", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${getConfig().PUBLIC_BASE_URL}${req.url}`;
    const signature = req.headers["x-twilio-signature"];
    const ok = validateTwilioSignature({
      signatureHeader: Array.isArray(signature) ? signature[0] : signature,
      url: fullUrl,
      params,
    });
    if (!ok) {
      logger.warn("rejected inbound voice: bad signature");
      return reply.code(403).send("invalid signature");
    }

    const toNumber = params.To;
    if (!toNumber) {
      return reply.code(400).send("missing To");
    }

    const tenant = await unscoped((c) => findTenantByPhone(c, toNumber));

    if (!tenant) {
      logger.warn({ toNumber }, "inbound voice for unknown tenant number");
      await audit({
        tenantId: null,
        actor: "twilio",
        action: "inbound_unknown_number",
        metadata: { to: toNumber, channel: "voice" },
      });
      return reply
        .header("content-type", "text/xml")
        .code(200)
        .send(buildUnknownNumberTwiml());
    }

    const fwd = tenant.config.voice.forwardBeforeVoicemail;
    if (fwd?.enabled) {
      const actionUrl = `${getConfig().PUBLIC_BASE_URL}/twilio/voice/no-answer`;
      const xml = buildForwardTwiml({
        twilioNumber: tenant.twilioNumber,
        ownerPhoneE164: tenant.config.escalation.ownerPhoneE164,
        timeoutSeconds: fwd.timeoutSeconds,
        actionUrl,
      });
      await audit({
        tenantId: tenant.id,
        actor: "twilio",
        action: "voice_forwarded",
        metadata: {
          callSid: params.CallSid ?? null,
          timeoutSeconds: fwd.timeoutSeconds,
        },
      });
      return reply.header("content-type", "text/xml").code(200).send(xml);
    }

    const transcribeCallbackUrl = `${getConfig().PUBLIC_BASE_URL}/twilio/voice/transcription`;
    const xml = buildVoicemailTwiml({
      tenantName: tenant.name,
      voicemailGreeting: tenant.config.voice.voicemailGreeting ?? null,
      transcribeCallbackUrl,
    });

    await audit({
      tenantId: tenant.id,
      actor: "twilio",
      action: "voicemail_started",
      metadata: { callSid: params.CallSid ?? null },
    });

    return reply.header("content-type", "text/xml").code(200).send(xml);
  });

  /**
   * Twilio fires this when a <Dial> with action=... finishes. Request
   * includes the ORIGINAL To/From of the inbound call plus DialCallStatus,
   * DialCallSid, and DialCallDuration. If the owner answered, we just hang
   * up; if not, we drop into the voicemail TwiML and the flow continues
   * exactly as the voicemail-only path.
   */
  app.post("/twilio/voice/no-answer", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${getConfig().PUBLIC_BASE_URL}${req.url}`;
    const signature = req.headers["x-twilio-signature"];
    const ok = validateTwilioSignature({
      signatureHeader: Array.isArray(signature) ? signature[0] : signature,
      url: fullUrl,
      params,
    });
    if (!ok) {
      logger.warn("rejected voice no-answer: bad signature");
      return reply.code(403).send("invalid signature");
    }

    const toNumber = params.To;
    const dialStatus = params.DialCallStatus ?? "";
    if (!toNumber) {
      return reply.code(400).send("missing To");
    }

    if (!NO_ANSWER_STATUSES.has(dialStatus)) {
      return reply
        .header("content-type", "text/xml")
        .code(200)
        .send(buildCompletedTwiml());
    }

    const tenant = await unscoped((c) => findTenantByPhone(c, toNumber));
    if (!tenant) {
      logger.warn({ toNumber }, "no-answer callback for unknown tenant number");
      return reply
        .header("content-type", "text/xml")
        .code(200)
        .send(buildUnknownNumberTwiml());
    }

    const transcribeCallbackUrl = `${getConfig().PUBLIC_BASE_URL}/twilio/voice/transcription`;
    const xml = buildVoicemailTwiml({
      tenantName: tenant.name,
      voicemailGreeting: tenant.config.voice.voicemailGreeting ?? null,
      transcribeCallbackUrl,
    });

    await audit({
      tenantId: tenant.id,
      actor: "twilio",
      action: "voicemail_started",
      metadata: {
        callSid: params.CallSid ?? null,
        dialStatus,
        afterForward: true,
      },
    });

    return reply.header("content-type", "text/xml").code(200).send(xml);
  });

  /**
   * Twilio POSTs TranscriptionText + TranscriptionStatus here when the
   * transcription job finishes. We route the transcript through the same
   * orchestrator as an inbound SMS.
   *
   * NB: on this callback `From` is the *caller's* number (our SMS reply target)
   * and `To` is the tenant's Twilio number (used for tenant lookup).
   */
  app.post("/twilio/voice/transcription", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${getConfig().PUBLIC_BASE_URL}${req.url}`;
    const signature = req.headers["x-twilio-signature"];
    const ok = validateTwilioSignature({
      signatureHeader: Array.isArray(signature) ? signature[0] : signature,
      url: fullUrl,
      params,
    });
    if (!ok) {
      logger.warn("rejected voice transcription: bad signature");
      return reply.code(403).send("invalid signature");
    }

    const toNumber = params.To;
    const fromNumber = params.From;
    const status = params.TranscriptionStatus;
    const transcript = (params.TranscriptionText ?? "").toString().trim();
    if (!toNumber || !fromNumber) {
      return reply.code(400).send("missing required fields");
    }

    if (status !== "completed" || transcript.length === 0) {
      logger.warn({ status }, "voicemail transcription unusable — falling back");
      const tenant = await unscoped((c) => findTenantByPhone(c, toNumber));
      if (tenant) {
        try {
          await sendSms({
            from: tenant.twilioNumber,
            to: fromNumber,
            body: FALLBACK_SMS,
          });
        } catch (err) {
          logger.error({ err }, "voice fallback sms failed");
        }
        await audit({
          tenantId: tenant.id,
          actor: "twilio",
          action: "voicemail_transcription_unusable",
          metadata: { status: status ?? null },
        });
      }
      return reply.code(204).send();
    }

    await handleInboundTurn({
      toNumber,
      fromNumber,
      inboundText: transcript,
      channel: "voice",
    });

    return reply.code(204).send();
  });
};
