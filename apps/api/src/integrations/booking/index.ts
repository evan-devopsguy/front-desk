import type { BookingAdapter, BookingAdapterContext } from "./types.js";
import { MockBookingAdapter } from "./mock.js";
import { BoulevardBookingAdapter } from "./boulevard.js";
import { VagaroBookingAdapter } from "./vagaro.js";

export function createBookingAdapter(
  kind: "mock" | "boulevard" | "vagaro",
  ctx: BookingAdapterContext,
): BookingAdapter {
  switch (kind) {
    case "mock":
      return new MockBookingAdapter(ctx);
    case "boulevard":
      return new BoulevardBookingAdapter(ctx);
    case "vagaro":
      return new VagaroBookingAdapter(ctx);
  }
}

export * from "./types.js";
