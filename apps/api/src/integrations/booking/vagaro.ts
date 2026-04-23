import type {
  AvailabilitySlot,
  BookingRequest,
  BookingResult,
} from "@medspa/shared";
import {
  BookingAdapterError,
  type BookingAdapter,
  type BookingAdapterContext,
} from "./types.js";

/**
 * Vagaro adapter stub. Vagaro's partner API is REST + OAuth. Same pattern as
 * Boulevard — swap in-place by setting tenants.booking_adapter = 'vagaro'.
 */
export class VagaroBookingAdapter implements BookingAdapter {
  readonly name = "vagaro" as const;

  constructor(private readonly ctx: BookingAdapterContext) {
    if (!ctx.credentials?.accessToken) {
      throw new BookingAdapterError(
        "auth_failed",
        "Vagaro adapter requires accessToken in credentials",
      );
    }
  }

  async checkAvailability(_args: {
    serviceId: string;
    from: string;
    to: string;
    limit: number;
  }): Promise<AvailabilitySlot[]> {
    throw new BookingAdapterError(
      "unknown",
      "Vagaro.checkAvailability not implemented — build against Vagaro Partner API docs",
    );
  }

  async createBooking(_req: BookingRequest): Promise<BookingResult> {
    throw new BookingAdapterError(
      "unknown",
      "Vagaro.createBooking not implemented",
    );
  }

  async cancelBooking(_id: string): Promise<void> {
    throw new BookingAdapterError(
      "unknown",
      "Vagaro.cancelBooking not implemented",
    );
  }
}
