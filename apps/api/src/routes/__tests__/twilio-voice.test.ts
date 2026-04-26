/**
 * twilio-voice.test.ts — unit tests for voice webhook helpers.
 *
 * Integration coverage (transcription → orchestrator → SMS reply) lives in
 * the eval harness where a real DB + mocked Bedrock are available. Here we
 * exercise the pure TwiML builders that don't need either.
 */
import { describe, expect, it } from "vitest";
import {
  buildCompletedTwiml,
  buildForwardTwiml,
  buildGreeting,
  buildVoicemailTwiml,
} from "../twilio-voice.js";

describe("buildGreeting", () => {
  it("returns the tenant override when provided", () => {
    const out = buildGreeting("Aurora Med Spa", "You have reached Aurora.");
    expect(out).toBe("You have reached Aurora.");
  });

  it("trims whitespace-only overrides and falls back to default", () => {
    const out = buildGreeting("Aurora Med Spa", "   ");
    expect(out).toContain("Aurora Med Spa");
    expect(out).toContain("leave a short message");
  });

  it("uses a tenant-branded default when no override is set", () => {
    const out = buildGreeting("Aurora Med Spa", null);
    expect(out).toContain("Aurora Med Spa");
    expect(out.toLowerCase()).toContain("text you right back");
  });
});

describe("buildVoicemailTwiml", () => {
  it("plays the greeting, records with transcribe, and sends Twilio to our callback", () => {
    const xml = buildVoicemailTwiml({
      tenantName: "Cooper Family Garage Doors",
      voicemailGreeting: null,
      transcribeCallbackUrl:
        "https://api.example.com/twilio/voice/transcription",
    });
    expect(xml).toContain("<Say");
    expect(xml).toContain("Cooper Family Garage Doors");
    expect(xml).toMatch(/<Record[^>]*transcribe="true"/);
    expect(xml).toContain(
      'transcribeCallback="https://api.example.com/twilio/voice/transcription"',
    );
    expect(xml).toContain("<Hangup/>");
  });

  it("honors a tenant's custom voicemail greeting", () => {
    const xml = buildVoicemailTwiml({
      tenantName: "Cooper Family Garage Doors",
      voicemailGreeting: "Thanks for calling the Cooper family.",
      transcribeCallbackUrl: "https://x/y",
    });
    expect(xml).toContain("Thanks for calling the Cooper family.");
    // the default greeting's fallback text must NOT appear
    expect(xml).not.toContain("text you right back");
  });
});

describe("buildForwardTwiml", () => {
  const xml = buildForwardTwiml({
    twilioNumber: "+19097669426",
    ownerPhoneE164: "+17145537547",
    timeoutSeconds: 18,
    actionUrl: "https://api.example.com/twilio/voice/no-answer",
  });

  it("dials the owner's cell", () => {
    expect(xml).toContain("+17145537547");
  });

  it("sets caller ID to the tenant's Twilio number so owner sees a known contact", () => {
    expect(xml).toContain('callerId="+19097669426"');
  });

  it("uses the configured timeout and fallback action URL", () => {
    expect(xml).toContain('timeout="18"');
    expect(xml).toContain(
      'action="https://api.example.com/twilio/voice/no-answer"',
    );
    expect(xml).toContain('method="POST"');
  });

  it("uses answerOnBridge so the caller hears real ringing, not hold music", () => {
    expect(xml).toMatch(/answerOnBridge="true"/);
  });

  it("does NOT record voicemail on this leg (recording happens after no-answer)", () => {
    expect(xml).not.toContain("<Record");
    expect(xml).not.toContain("transcribe");
  });
});

describe("buildCompletedTwiml", () => {
  it("returns a bare Hangup — nothing else to do", () => {
    const xml = buildCompletedTwiml();
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
    expect(xml).not.toContain("<Record");
    expect(xml).not.toContain("<Say");
  });
});
