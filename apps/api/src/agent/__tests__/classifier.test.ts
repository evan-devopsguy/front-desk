/**
 * classifier.test.ts — exercises the classifier via the Bedrock mock so we
 * can assert deterministic routing decisions without real AWS calls.
 */
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.MOCK_BEDROCK = "1";
  // Ensure getConfig() accepts minimal env in test
  process.env.DATABASE_URL = "postgres://x:y@localhost:5432/x";
});

describe("classifier (mock bedrock)", () => {
  it("routes clinical questions to clinical", async () => {
    const { classifyIntent } = await import("../classifier.js");
    const intent = await classifyIntent(
      "Is Botox safe during pregnancy? I'm 12 weeks.",
    );
    expect(intent).toBe("clinical");
  });

  it("routes booking requests to booking", async () => {
    const { classifyIntent } = await import("../classifier.js");
    const intent = await classifyIntent("I'd like to book a hydrafacial.");
    expect(intent).toBe("booking");
  });

  it("routes price questions to faq", async () => {
    const { classifyIntent } = await import("../classifier.js");
    const intent = await classifyIntent("How much is a hydrafacial?");
    expect(intent).toBe("faq");
  });

  it("routes complaints to complaint", async () => {
    const { classifyIntent } = await import("../classifier.js");
    const intent = await classifyIntent(
      "My cheek is really swollen and painful after my botox appointment.",
    );
    expect(intent).toBe("complaint");
  });

  it("routes outreach to spam", async () => {
    const { classifyIntent } = await import("../classifier.js");
    const intent = await classifyIntent(
      "Hi, I'm with an SEO agency and can boost your ranking",
    );
    expect(intent).toBe("spam");
  });
});
