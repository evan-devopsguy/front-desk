import type { BookingAdapter, BookingAdapterContext } from "./types.js";
import { MockBookingAdapter } from "./mock.js";
import { BoulevardBookingAdapter } from "./boulevard.js";
import { VagaroBookingAdapter } from "./vagaro.js";

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
      // Phase 3 will add this adapter. Until then, calling it is a hard error.
      throw new Error(
        "google-calendar booking adapter not implemented (Phase 3)",
      );
  }
}

export * from "./types.js";
