/**
 * twilio-voice.test.ts — unit tests for voice webhook helpers.
 *
 * Integration coverage (transcription → orchestrator → SMS reply) lives in
 * the eval harness where a real DB + mocked Bedrock are available. Here we
 * exercise the pure bits that don't need either.
 */
import { describe, expect, it } from "vitest";
import { buildGreeting } from "../twilio-voice.js";

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
