import type {
  AvailabilitySlot,
  BookingRequest,
  BookingResult,
  TenantConfig,
} from "@medspa/shared";

export interface BookingAdapterContext {
  tenantId: string;
  tenantConfig: TenantConfig;
  /** Secret material fetched from Secrets Manager at boot. Empty for mock. */
  credentials?: Record<string, string>;
}

export interface BookingAdapter {
  readonly name: "mock" | "boulevard" | "vagaro" | "google-calendar";

  /**
   * List available slots for a service in [from, to]. Must return no more
   * than `limit` slots, respecting the tenant's minLeadTime and business
   * hours.
   */
  checkAvailability(args: {
    serviceId: string;
    from: string;
    to: string;
    limit: number;
  }): Promise<AvailabilitySlot[]>;

  /**
   * Create a booking. Must be idempotent on (contactPhoneE164, start) so
   * retries do not double-book.
   */
  createBooking(req: BookingRequest): Promise<BookingResult>;

  /**
   * Cancel a booking by the external id returned from createBooking.
   */
  cancelBooking(externalBookingId: string): Promise<void>;
}

export class BookingAdapterError extends Error {
  constructor(
    public readonly code:
      | "no_availability"
      | "slot_taken"
      | "invalid_service"
      | "auth_failed"
      | "rate_limited"
      | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "BookingAdapterError";
  }
}
