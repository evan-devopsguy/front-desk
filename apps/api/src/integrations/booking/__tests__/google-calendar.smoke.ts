import { describe, it, expect } from "vitest";
import { createGoogleCalendarAdapter } from "../google-calendar.js";
import { tenantConfigSchema } from "@medspa/shared";

const SMOKE = process.env["GOOGLE_CALENDAR_SMOKE"];

describe.skipIf(!SMOKE)("google-calendar adapter smoke test", () => {
  it("creates and deletes a real calendar event", async () => {
    const creds = JSON.parse(SMOKE!);
    const config = tenantConfigSchema.parse({
      displayName: "Smoke Test Co",
      timezone: "America/Phoenix",
      hours: { mon: { open: "08:00", close: "18:00" }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
      services: [{ id: "service_call", name: "Service call", description: "test", durationMinutes: 60, priceCents: 0, providerTags: [], requiresConsult: false }],
      voice: { tone: "friendly", signOff: "", maxSmsChars: 320 },
      escalation: { ownerPhoneE164: "+15550000000", escalateOn: ["complaint", "manual"], quietHours: null },
      booking: { minLeadTimeMinutes: 0, maxAdvanceDays: 30, defaultProviderId: null },
      knowledgeSources: [],
    });

    const adapter = createGoogleCalendarAdapter({
      tenantId: "smoke-test",
      tenantConfig: config,
      credentials: creds,
    });

    const startIso = new Date(Date.now() + 60 * 60_000).toISOString();

    const result = await adapter.createBooking({
      serviceId: "service_call",
      start: startIso,
      contactName: "Smoke Test",
      contactPhoneE164: "+15550000001",
      providerId: null,
      notes: "automated smoke test",
      address: "123 Test St",
      problemDescription: "smoke test event — safe to delete",
    });

    expect(result.externalBookingId).toBeTruthy();

    await adapter.cancelBooking(result.externalBookingId);
  }, 30_000);
});
