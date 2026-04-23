import type {
  AvailabilitySlot,
  BookingRequest,
  BookingResult,
} from "@medspa/shared";
import { randomUUID } from "node:crypto";
import {
  BookingAdapterError,
  type BookingAdapter,
  type BookingAdapterContext,
} from "./types.js";

/**
 * In-memory booking adapter for MVP demos. Availability is computed live from
 * the tenant's business hours; bookings are held in a per-tenant map. The
 * store is module-global so restarts reset it — that's fine for demos.
 *
 * Idempotency key: `${tenantId}:${contactPhoneE164}:${start}`.
 */

type StoredBooking = {
  id: string;
  tenantId: string;
  serviceId: string;
  start: string;
  providerId: string | null;
  contactPhoneE164: string;
};

const bookings = new Map<string, StoredBooking>();

export class MockBookingAdapter implements BookingAdapter {
  readonly name = "mock" as const;
  constructor(private readonly ctx: BookingAdapterContext) {}

  async checkAvailability(args: {
    serviceId: string;
    from: string;
    to: string;
    limit: number;
  }): Promise<AvailabilitySlot[]> {
    const service = this.ctx.tenantConfig.services.find(
      (s) => s.id === args.serviceId,
    );
    if (!service) {
      throw new BookingAdapterError(
        "invalid_service",
        `unknown service: ${args.serviceId}`,
      );
    }

    const from = new Date(args.from);
    const to = new Date(args.to);
    const slots: AvailabilitySlot[] = [];
    const cursor = new Date(from);
    const minLead =
      (this.ctx.tenantConfig.booking.minLeadTimeMinutes ?? 120) * 60_000;
    const earliest = new Date(Date.now() + minLead);

    while (cursor <= to && slots.length < args.limit) {
      if (cursor < earliest) {
        cursor.setMinutes(cursor.getMinutes() + 30);
        continue;
      }
      const weekday = weekdayKey(cursor);
      const hours = this.ctx.tenantConfig.hours[weekday];
      if (!hours) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
        continue;
      }
      const [openH, openM] = hours.open.split(":").map(Number) as [
        number,
        number,
      ];
      const [closeH, closeM] = hours.close.split(":").map(Number) as [
        number,
        number,
      ];
      const dayOpen = new Date(cursor);
      dayOpen.setHours(openH, openM, 0, 0);
      const dayClose = new Date(cursor);
      dayClose.setHours(closeH, closeM, 0, 0);

      if (cursor < dayOpen) {
        cursor.setTime(dayOpen.getTime());
      }
      if (cursor >= dayClose) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
        continue;
      }

      const end = new Date(
        cursor.getTime() + service.durationMinutes * 60_000,
      );
      if (end > dayClose) {
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
        continue;
      }

      const taken = [...bookings.values()].some(
        (b) =>
          b.tenantId === this.ctx.tenantId &&
          Math.abs(new Date(b.start).getTime() - cursor.getTime()) <
            service.durationMinutes * 60_000,
      );
      if (!taken) {
        slots.push({
          start: cursor.toISOString(),
          end: end.toISOString(),
          providerId: this.ctx.tenantConfig.booking.defaultProviderId,
        });
      }
      cursor.setMinutes(cursor.getMinutes() + 30);
    }
    return slots;
  }

  async createBooking(req: BookingRequest): Promise<BookingResult> {
    const service = this.ctx.tenantConfig.services.find(
      (s) => s.id === req.serviceId,
    );
    if (!service) {
      throw new BookingAdapterError(
        "invalid_service",
        `unknown service: ${req.serviceId}`,
      );
    }
    const idemKey = `${this.ctx.tenantId}:${req.contactPhoneE164}:${req.start}`;
    const existing = bookings.get(idemKey);
    if (existing) {
      return {
        externalBookingId: existing.id,
        confirmedStart: existing.start,
        serviceId: existing.serviceId,
        providerId: existing.providerId,
      };
    }

    const conflict = [...bookings.values()].some(
      (b) =>
        b.tenantId === this.ctx.tenantId &&
        Math.abs(new Date(b.start).getTime() - new Date(req.start).getTime()) <
          service.durationMinutes * 60_000,
    );
    if (conflict) {
      throw new BookingAdapterError("slot_taken", "slot no longer available");
    }

    const id = randomUUID();
    const stored: StoredBooking = {
      id,
      tenantId: this.ctx.tenantId,
      serviceId: req.serviceId,
      start: req.start,
      providerId: req.providerId,
      contactPhoneE164: req.contactPhoneE164,
    };
    bookings.set(idemKey, stored);
    return {
      externalBookingId: id,
      confirmedStart: req.start,
      serviceId: req.serviceId,
      providerId: req.providerId,
    };
  }

  async cancelBooking(externalBookingId: string): Promise<void> {
    for (const [key, b] of bookings) {
      if (b.id === externalBookingId && b.tenantId === this.ctx.tenantId) {
        bookings.delete(key);
        return;
      }
    }
  }
}

function weekdayKey(d: Date): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return keys[d.getDay()] as (typeof keys)[number];
}

// ------- Test helpers (used by eval harness to reset state between runs) ----
export function __resetMockBookings(): void {
  bookings.clear();
}
export function __listMockBookings(): StoredBooking[] {
  return [...bookings.values()];
}
