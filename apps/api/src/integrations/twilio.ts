import twilio from "twilio";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

let clientSingleton: ReturnType<typeof twilio> | null = null;
function client() {
  if (!clientSingleton) {
    const cfg = getConfig();
    if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN) {
      throw new Error("Twilio credentials not configured");
    }
    clientSingleton = twilio(cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN);
  }
  return clientSingleton;
}

/**
 * Validate Twilio's X-Twilio-Signature against the full request URL + body.
 * Returns true iff the signature matches the configured auth token. In dev
 * (no auth token) we return true to unblock local testing over ngrok.
 */
export function validateTwilioSignature(args: {
  signatureHeader: string | undefined;
  url: string;
  params: Record<string, string>;
}): boolean {
  const token = getConfig().TWILIO_AUTH_TOKEN;
  if (!token) {
    logger.warn("TWILIO_AUTH_TOKEN not set — skipping signature validation");
    return true;
  }
  if (!args.signatureHeader) return false;
  return twilio.validateRequest(
    token,
    args.signatureHeader,
    args.url,
    args.params,
  );
}

export async function sendSms(args: {
  from: string;
  to: string;
  body: string;
}): Promise<void> {
  await client().messages.create({
    from: args.from,
    to: args.to,
    body: args.body,
  });
}
