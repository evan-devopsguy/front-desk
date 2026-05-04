import { describe, expect, it } from "vitest";
import { hashPhone, redact, redactString } from "../pii.js";

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

  it.each([
    "+19097669426",
    "(909) 766-9426",
    "909-766-9426",
    "909.766.9426",
    "9097669426",
    "1-909-766-9426",
  ])("redacts phone format %s", (s) => {
    expect(redactString(`called from ${s} earlier`)).toContain("[PHONE]");
  });

  it.each([
    [
      "AWS account ID",
      "arn:aws:secretsmanager:us-east-1:271251179226:secret:front-desk/x",
    ],
    ["bare 12-digit account ID", "account 271251179226 has access"],
    ["UUID", "tenant ba524539-24f9-4c86-a359-fd10a43eaf25 routed"],
    [
      "all-digit UUID block",
      "id 12345678-1234-1234-1234-123456789012 ok",
    ],
    ["unix ms timestamp", "ts=1672531200000 closed"],
  ])("does not redact %s", (_, s) => {
    expect(redactString(s)).not.toContain("[PHONE]");
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
