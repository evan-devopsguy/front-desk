/**
 * Unit tests for validateTwilioSignature. This is the gate every Twilio
 * webhook route passes through — if it returns false, the route replies 403.
 * Testing the gate directly means every route gets coverage of the rejection
 * path without spinning up a full Fastify app per route.
 */
import crypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const token = "test-auth-token-0123456789abcdef";

/**
 * Recreate Twilio's signature algorithm locally: HMAC-SHA1 of
 * (URL + sorted-key-value-pairs-concatenated), base64-encoded, keyed by the
 * auth token. We avoid importing Twilio's internal helper so the test
 * doesn't depend on library internals.
 * Ref: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function twilioSign(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + (params[k] ?? "");
  return crypto.createHmac("sha1", authToken).update(data).digest("base64");
}

beforeAll(() => {
  // getConfig() requires a DB url even though this test never touches one.
  process.env.DATABASE_URL = "postgres://x:y@localhost:5432/x";
});

beforeEach(() => {
  // getConfig() caches parsed env in a module-level var. Reset so that
  // TWILIO_AUTH_TOKEN changes per test actually take effect.
  vi.resetModules();
});

describe("validateTwilioSignature", () => {
  it("rejects requests with a missing X-Twilio-Signature header when a token is configured", async () => {
    process.env.TWILIO_AUTH_TOKEN = token;
    const { validateTwilioSignature } = await import("../twilio.js");
    const ok = validateTwilioSignature({
      signatureHeader: undefined,
      url: "https://api.example.com/twilio/voice",
      params: { To: "+19097669426", From: "+15555551234" },
    });
    expect(ok).toBe(false);
  });

  it("rejects requests with an incorrect signature", async () => {
    process.env.TWILIO_AUTH_TOKEN = token;
    const { validateTwilioSignature } = await import("../twilio.js");
    const ok = validateTwilioSignature({
      signatureHeader: "clearly-not-a-real-signature",
      url: "https://api.example.com/twilio/voice",
      params: { To: "+19097669426", From: "+15555551234" },
    });
    expect(ok).toBe(false);
  });

  it("accepts a correctly signed request (proves the happy path works end-to-end)", async () => {
    process.env.TWILIO_AUTH_TOKEN = token;
    const { validateTwilioSignature } = await import("../twilio.js");
    const url = "https://api.example.com/twilio/voice/no-answer";
    const params = {
      To: "+19097669426",
      From: "+15555551234",
      DialCallStatus: "no-answer",
      CallSid: "CA123",
    };
    const realSig = twilioSign(token, url, params);
    const ok = validateTwilioSignature({
      signatureHeader: realSig,
      url,
      params,
    });
    expect(ok).toBe(true);
  });

  it("skips validation in dev when no auth token is configured (local ngrok affordance)", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const { validateTwilioSignature } = await import("../twilio.js");
    const ok = validateTwilioSignature({
      signatureHeader: undefined,
      url: "https://api.example.com/twilio/voice",
      params: {},
    });
    expect(ok).toBe(true);
  });
});
