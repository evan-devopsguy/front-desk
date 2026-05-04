import { describe, expect, it } from "vitest";
import { buildOwnerAlertBody, notifyOwnerInputSchema } from "../owner-alert.js";

describe("buildOwnerAlertBody", () => {
  describe("emergency urgency", () => {
    it("with address and slaMinutes contains URGENT, summary, callbackPhone, address, SLA", () => {
      const body = buildOwnerAlertBody({
        tenantName: "Acme Garage",
        urgency: "emergency",
        summary: "Car trapped in garage, door won't open",
        callbackPhone: "+12025551234",
        address: "123 Main St",
        slaMinutes: 15,
      });
      expect(body).toContain("🚨 URGENT");
      expect(body).toContain("Car trapped in garage, door won't open");
      expect(body).toContain("+12025551234");
      expect(body).toContain("123 Main St");
      expect(body).toContain("SLA 15min");
    });

    it("without address or slaMinutes omits Address and SLA segments", () => {
      const body = buildOwnerAlertBody({
        tenantName: "Acme Garage",
        urgency: "emergency",
        summary: "Safety hazard reported",
        callbackPhone: "+12025551234",
      });
      expect(body).toContain("🚨 URGENT");
      expect(body).toContain("Safety hazard reported");
      expect(body).toContain("+12025551234");
      expect(body).not.toContain("Address:");
      expect(body).not.toContain("SLA");
    });
  });

  describe("complaint urgency", () => {
    it("with address contains Callback needed, callbackPhone, and address", () => {
      const body = buildOwnerAlertBody({
        tenantName: "Acme Garage",
        urgency: "complaint",
        summary: "Technician left oil stains on driveway",
        callbackPhone: "+13015559876",
        address: "456 Oak Ave",
      });
      expect(body).toContain("Callback needed");
      expect(body).toContain("+13015559876");
      expect(body).toContain("456 Oak Ave");
    });

    it("without address omits Address segment", () => {
      const body = buildOwnerAlertBody({
        tenantName: "Acme Garage",
        urgency: "complaint",
        summary: "Unhappy with prior service",
        callbackPhone: "+13015559876",
      });
      expect(body).toContain("Callback needed");
      expect(body).toContain("+13015559876");
      expect(body).not.toContain("Address:");
    });
  });

  describe("fyi urgency", () => {
    it("starts with FYI: and includes summary", () => {
      const body = buildOwnerAlertBody({
        tenantName: "Acme Garage",
        urgency: "fyi",
        summary: "Caller out of service area, referred elsewhere",
        callbackPhone: "+14045550000",
      });
      expect(body).toContain("FYI:");
      expect(body).toContain("Caller out of service area, referred elsewhere");
      expect(body).not.toContain("+14045550000"); // phone withheld in fyi template
    });
  });

  it("includes summary verbatim in the output", () => {
    const summary = "Exact verbatim summary text for test";
    const body = buildOwnerAlertBody({
      tenantName: "Acme Garage",
      urgency: "fyi",
      summary,
      callbackPhone: "+12025550001",
    });
    expect(body).toContain(summary);
  });
});

describe("notifyOwnerInputSchema", () => {
  const base = {
    urgency: "emergency" as const,
    callbackPhone: "+12025551234",
  };

  it("accepts a 320-char summary", () => {
    const r = notifyOwnerInputSchema.safeParse({
      ...base,
      summary: "x".repeat(320),
    });
    expect(r.success).toBe(true);
  });

  it("rejects a 321-char summary", () => {
    const r = notifyOwnerInputSchema.safeParse({
      ...base,
      summary: "x".repeat(321),
    });
    expect(r.success).toBe(false);
  });

  it("preserves a long real-world transcript verbatim through the body", () => {
    const summary =
      "Caller from 909 area: garage door spring snapped at 7am, car physically trapped inside, she has work in 30 minutes — I tried the manual release but it's seized and the door is jammed about 6 inches off the ground, can someone come out as soon as possible please";
    expect(summary.length).toBeGreaterThan(160);
    expect(summary.length).toBeLessThanOrEqual(320);
    const parsed = notifyOwnerInputSchema.parse({ ...base, summary });
    const body = buildOwnerAlertBody({
      tenantName: "Cooper Family Garage Doors",
      urgency: parsed.urgency,
      summary: parsed.summary,
      callbackPhone: parsed.callbackPhone,
      slaMinutes: 60,
    });
    expect(body).toContain(summary);
  });
});
