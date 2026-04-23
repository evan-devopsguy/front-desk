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
 * Voice pipeline — after-hours voicemail → transcription → SMS reply.
 *
 *   POST /twilio/voice                 TwiML: greeting + <Record> with transcribe
 *   POST /twilio/voice/transcription   Twilio posts the transcript here; we feed
 *                                      it through the same orchestrator as SMS
 *                                      and text the caller back.
 *
 * We never answer the call live. A phone call becomes an asynchronous SMS
 * conversation: the caller leaves a short voicemail, Twilio transcribes it,
 * and the agent replies by SMS to the caller's number. This reuses 100% of
 * the SMS code path — no second orchestrator, no duplicated tools.
 *
 * If transcription fails (noisy line, silence, too short), we send a courteous
 * fallback SMS inviting the caller to text us instead.
 */

const FALLBACK_SMS =
  "Hi — thanks for calling. We couldn't quite make out your voicemail. Please reply to this text and we'll help you from here.";

/**
 * Build the voicemail greeting. A tenant may override via config; otherwise we
 * generate a sensible default from the spa name.
 */
export function buildGreeting(
  tenantName: string,
  override: string | null | undefined,
): string {
  if (override && override.trim().length > 0) return override.trim();
  return `Hi, thanks for calling ${tenantName}. We can't take your call right now, but if you leave a short message after the beep we'll text you right back.`;
}

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
    const twiml = new twilio.twiml.VoiceResponse();

    if (!tenant) {
      logger.warn({ toNumber }, "inbound voice for unknown tenant number");
      await audit({
        tenantId: null,
        actor: "twilio",
        action: "inbound_unknown_number",
        metadata: { to: toNumber, channel: "voice" },
      });
      twiml.say("Sorry, this number is not in service.");
      twiml.hangup();
      return reply
        .header("content-type", "text/xml")
        .code(200)
        .send(twiml.toString());
    }

    const greeting = buildGreeting(
      tenant.name,
      tenant.config.voice.voicemailGreeting ?? null,
    );
    const transcribeCallbackUrl = `${getConfig().PUBLIC_BASE_URL}/twilio/voice/transcription`;

    twiml.say({ voice: "alice" }, greeting);
    twiml.record({
      maxLength: 90,
      timeout: 3,
      playBeep: true,
      trim: "trim-silence",
      transcribe: true,
      transcribeCallback: transcribeCallbackUrl,
    });
    // If the caller runs out <Record> without a transcription event (e.g. they
    // hung up before anything was captured), still promise a follow-up.
    twiml.say("Thanks — we'll text you back shortly.");
    twiml.hangup();

    await audit({
      tenantId: tenant.id,
      actor: "twilio",
      action: "voicemail_started",
      metadata: { callSid: params.CallSid ?? null },
    });

    return reply
      .header("content-type", "text/xml")
      .code(200)
      .send(twiml.toString());
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
