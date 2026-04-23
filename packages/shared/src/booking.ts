import { z } from "zod";

export const availabilitySlotSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  providerId: z.string().nullable(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const bookingRequestSchema = z.object({
  serviceId: z.string(),
  start: z.string().datetime(),
  contactName: z.string().min(1),
  contactPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  providerId: z.string().nullable().default(null),
  notes: z.string().default(""),
  address: z.string().optional(),
  problemDescription: z.string().optional(),
});
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const bookingResultSchema = z.object({
  externalBookingId: z.string(),
  confirmedStart: z.string().datetime(),
  serviceId: z.string(),
  providerId: z.string().nullable(),
});
export type BookingResult = z.infer<typeof bookingResultSchema>;
