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
 * Boulevard adapter stub. Boulevard's GraphQL API requires per-tenant API
 * credentials; we surface a clear "not yet implemented" error rather than
 * silently doing the wrong thing. Credentials are fetched from Secrets
 * Manager in BookingAdapterContext.credentials.
 *
 * Real implementation lives behind this interface — swap in-place by
 * changing tenants.booking_adapter = 'boulevard'.
 */
export class BoulevardBookingAdapter implements BookingAdapter {
  readonly name = "boulevard" as const;

  constructor(private readonly ctx: BookingAdapterContext) {
    if (!ctx.credentials?.apiKey || !ctx.credentials?.businessId) {
      throw new BookingAdapterError(
        "auth_failed",
        "Boulevard adapter requires apiKey and businessId in credentials",
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
      "Boulevard.checkAvailability not implemented — build against https://developers.joinblvd.com/",
    );
  }

  async createBooking(_req: BookingRequest): Promise<BookingResult> {
    throw new BookingAdapterError(
      "unknown",
      "Boulevard.createBooking not implemented",
    );
  }

  async cancelBooking(_id: string): Promise<void> {
    throw new BookingAdapterError(
      "unknown",
      "Boulevard.cancelBooking not implemented",
    );
  }
}
