import type { BookingAdapter, BookingAdapterContext } from "./types.js";
import { MockBookingAdapter } from "./mock.js";
import { BoulevardBookingAdapter } from "./boulevard.js";
import { VagaroBookingAdapter } from "./vagaro.js";
import { createGoogleCalendarAdapter } from "./google-calendar.js";

export function createBookingAdapter(
  kind: "mock" | "boulevard" | "vagaro" | "google-calendar",
  ctx: BookingAdapterContext,
): BookingAdapter {
  switch (kind) {
    case "mock":
      return new MockBookingAdapter(ctx);
    case "boulevard":
      return new BoulevardBookingAdapter(ctx);
    case "vagaro":
      return new VagaroBookingAdapter(ctx);
    case "google-calendar":
      return createGoogleCalendarAdapter(ctx);
  }
}

export * from "./types.js";
