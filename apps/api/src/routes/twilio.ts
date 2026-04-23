import type { FastifyPluginAsync } from "fastify";
import { validateTwilioSignature } from "../integrations/twilio.js";
import { getConfig } from "../lib/config.js";
import { handleInboundTurn } from "../lib/inbound-turn.js";
import { logger } from "../lib/logger.js";

/**
 * POST /twilio/sms — inbound SMS webhook. Twilio posts form-urlencoded body
 * containing at least: From, To, Body, MessageSid, AccountSid.
 *
 * We:
 *   1. Validate X-Twilio-Signature.
 *   2. Delegate to handleInboundTurn (shared with the voice-transcription
 *      webhook) which resolves the tenant, runs the orchestrator, and sends
 *      the reply SMS.
 *   3. Respond 204 to Twilio.
 *
 * Responding 204 (No Content) avoids duplicating the message as TwiML — we
 * send via the REST API so we control timing and can split long messages.
 */
export const twilioRoutes: FastifyPluginAsync = async (app) => {
  app.post("/twilio/sms", async (req, reply) => {
    const params = (req.body ?? {}) as Record<string, string>;
    const fullUrl = `${getConfig().PUBLIC_BASE_URL}${req.url}`;
    const signature = req.headers["x-twilio-signature"];
    const ok = validateTwilioSignature({
      signatureHeader: Array.isArray(signature) ? signature[0] : signature,
      url: fullUrl,
      params,
    });
    if (!ok) {
      logger.warn("rejected inbound sms: bad signature");
      return reply.code(403).send("invalid signature");
    }

    const toNumber = params.To;
    const fromNumber = params.From;
    const body = (params.Body ?? "").toString();
    if (!toNumber || !fromNumber || !body) {
      return reply.code(400).send("missing required fields");
    }

    await handleInboundTurn({
      toNumber,
      fromNumber,
      inboundText: body,
      channel: "sms",
    });

    return reply.code(204).send();
  });
};
