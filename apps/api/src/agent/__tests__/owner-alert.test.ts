import { describe, expect, it } from "vitest";
import { buildOwnerAlertBody } from "../owner-alert.js";

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
