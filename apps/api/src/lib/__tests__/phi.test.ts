import { describe, expect, it } from "vitest";
import { hashPhone, redact, redactString } from "../phi.js";

describe("redactString", () => {
  it("redacts phone-like sequences", () => {
    expect(redactString("call me at +1 (415) 555-1234")).toContain("[PHONE]");
  });
  it("redacts emails", () => {
    expect(redactString("email jamie@example.com tomorrow")).toContain(
      "[EMAIL]",
    );
  });
  it("redacts SSNs", () => {
    expect(redactString("SSN 123-45-6789")).toContain("[SSN]");
  });
});

describe("redact (object)", () => {
  it("masks known-sensitive keys", () => {
    const out = redact({
      patientName: "Jamie Rivera",
      patientPhone: "+14155551234",
      conversationId: "abc",
    }) as Record<string, unknown>;
    expect(out.patientName).toBe("[REDACTED]");
    expect(out.patientPhone).toBe("[REDACTED]");
    expect(out.conversationId).toBe("abc");
  });

  it("recurses into arrays and nested objects", () => {
    const out = redact({
      list: [{ email: "a@b.com" }],
      free: "my phone is 415 555 1234",
    }) as { list: Array<{ email: string }>; free: string };
    expect(out.list[0]?.email).toBe("[REDACTED]");
    expect(out.free).toContain("[PHONE]");
  });
});

describe("hashPhone", () => {
  it("is deterministic per (tenant, phone)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const a = hashPhone("+14155551234", t);
    const b = hashPhone("+14155551234", t);
    expect(a).toBe(b);
  });
  it("differs across tenants (salted)", () => {
    const phone = "+14155551234";
    const a = hashPhone(phone, "tenant-a");
    const b = hashPhone(phone, "tenant-b");
    expect(a).not.toBe(b);
  });
});
