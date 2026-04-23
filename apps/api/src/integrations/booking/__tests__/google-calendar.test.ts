import { describe, it, expect } from "vitest";
import { computeOpenSlots } from "../google-calendar.js";

const BASE = "2026-05-01T08:00:00.000Z";
const TWO_HOURS_LATER = "2026-05-01T10:00:00.000Z";

function mins(n: number) {
  return new Date(new Date(BASE).getTime() + n * 60_000).toISOString();
}

describe("computeOpenSlots", () => {
  it("returns slots up to limit when calendar is empty", () => {
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: TWO_HOURS_LATER,
      durationMinutes: 60,
      busy: [],
      stepMinutes: 30,
      limit: 5,
    });
    // 08:00–09:00 and 08:30–09:30 and 09:00–10:00 fit; limit caps at 3
    expect(slots).toHaveLength(3);
    expect(slots[0]?.start).toBe(BASE);
  });

  it("returns empty array when calendar is fully busy", () => {
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: TWO_HOURS_LATER,
      durationMinutes: 60,
      busy: [{ start: BASE, end: TWO_HOURS_LATER }],
      stepMinutes: 30,
      limit: 5,
    });
    expect(slots).toHaveLength(0);
  });

  it("returns zero slots when 60-min appointment fully overlaps a 1h busy block", () => {
    // busy: 08:30–09:30
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: TWO_HOURS_LATER,
      durationMinutes: 60,
      busy: [{ start: mins(30), end: mins(90) }],
      stepMinutes: 30,
      limit: 5,
    });
    // Only 09:00–10:00 fits cleanly after the busy block ends at 09:30... wait:
    // t=08:00, slotEnd=09:00: busy 08:30–09:30 overlaps (08:00 < 09:30 && 09:00 > 08:30) → blocked
    // t=08:30, slotEnd=09:30: overlaps → blocked
    // t=09:00, slotEnd=10:00: busy ends 09:30, t=09:00 < 09:30, slotEnd=10:00 > 08:30 → overlaps → blocked
    // Actually all slots overlap. Let's use a tighter busy block.
    expect(slots).toHaveLength(0); // all 60-min slots in a 2h window overlap with a 1h busy
  });

  it("finds slots around a short busy block", () => {
    // busy: 08:30–08:45 (15 min)
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: TWO_HOURS_LATER,
      durationMinutes: 30,
      busy: [{ start: mins(30), end: mins(45) }],
      stepMinutes: 30,
      limit: 10,
    });
    // t=08:00–08:30: no overlap ✓
    // t=08:30–09:00: busy 08:30–08:45 overlaps → blocked
    // t=09:00–09:30: no overlap ✓
    // t=09:30–10:00: no overlap ✓
    expect(slots).toHaveLength(3);
    expect(slots[0]?.start).toBe(BASE);
    expect(slots[1]?.start).toBe(mins(60));
  });

  it("respects the limit parameter", () => {
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: "2026-05-01T18:00:00.000Z",
      durationMinutes: 30,
      busy: [],
      stepMinutes: 30,
      limit: 3,
    });
    expect(slots).toHaveLength(3);
  });

  it("returns empty when duration exceeds window", () => {
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: mins(30),
      durationMinutes: 60,
      busy: [],
      stepMinutes: 30,
      limit: 5,
    });
    expect(slots).toHaveLength(0);
  });

  it("slot at exact busy boundary is included", () => {
    // busy ends exactly at slot start → no overlap
    const slots = computeOpenSlots({
      fromIso: BASE,
      toIso: TWO_HOURS_LATER,
      durationMinutes: 60,
      busy: [{ start: mins(-60), end: BASE }],
      stepMinutes: 30,
      limit: 5,
    });
    // t < be && slotEnd > bs:  t=08:00, be=08:00 → 08:00 < 08:00 is false → no overlap
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.start).toBe(BASE);
  });
});
