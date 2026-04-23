import { google, type calendar_v3 } from "googleapis";
import type { BookingAdapter, BookingAdapterContext } from "./types.js";
import { BookingAdapterError } from "./types.js";
import type { AvailabilitySlot, BookingRequest, BookingResult } from "@medspa/shared";
import { logger } from "../../lib/logger.js";

export interface GoogleCalendarCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

function mapGoogleError(err: unknown): BookingAdapterError {
  const e = err as { code?: number; message?: string };
  if (e.code === 401 || e.code === 403) {
    return new BookingAdapterError("auth_failed", e.message ?? "google auth failed");
  }
  if (e.code === 429) {
    return new BookingAdapterError("rate_limited", e.message ?? "rate limited");
  }
  return new BookingAdapterError("unknown", (err as Error)?.message ?? String(err));
}

export function createGoogleCalendarAdapter(ctx: BookingAdapterContext): BookingAdapter {
  const creds = ctx.credentials as unknown as GoogleCalendarCredentials | undefined;
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    throw new BookingAdapterError("auth_failed", "missing google-calendar credentials");
  }
  const calendarId = "primary";
  const timezone = ctx.tenantConfig.timezone;

  const oauth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth.setCredentials({ refresh_token: creds.refresh_token });
  const calendar = google.calendar({ version: "v3", auth: oauth });

  return {
    name: "google-calendar" as const,

    async checkAvailability({ serviceId, from, to, limit }) {
      const service = ctx.tenantConfig.services.find((s) => s.id === serviceId);
      if (!service) throw new BookingAdapterError("invalid_service", serviceId);

      try {
        const fb = await calendar.freebusy.query({
          requestBody: {
            timeMin: from,
            timeMax: to,
            timeZone: timezone,
            items: [{ id: calendarId }],
          },
        });

        const busy = (fb.data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
          start: b.start ?? "",
          end: b.end ?? "",
        })).filter((b) => b.start && b.end);

        return computeOpenSlots({
          fromIso: from,
          toIso: to,
          durationMinutes: service.durationMinutes,
          busy,
          stepMinutes: 30,
          limit,
        });
      } catch (err) {
        throw mapGoogleError(err);
      }
    },

    async createBooking(req: BookingRequest): Promise<BookingResult> {
      const service = ctx.tenantConfig.services.find((s) => s.id === req.serviceId);
      if (!service) throw new BookingAdapterError("invalid_service", req.serviceId);

      const endIso = new Date(
        new Date(req.start).getTime() + service.durationMinutes * 60_000,
      ).toISOString();

      const title = `[Service Call] ${req.contactName} — ${truncate(req.problemDescription ?? service.name, 40)}`;

      const event: calendar_v3.Schema$Event = {
        summary: title,
        description: buildDescription(req),
        location: req.address,
        start: { dateTime: req.start, timeZone: timezone },
        end: { dateTime: endIso, timeZone: timezone },
        extendedProperties: {
          private: {
            source: "front-desk",
          },
        },
      };

      try {
        const res = await calendar.events.insert({ calendarId, requestBody: event });
        logger.info({ eventId: res.data.id, calendarId }, "google-calendar.event.created");
        return {
          externalBookingId: res.data.id!,
          confirmedStart: req.start,
          serviceId: req.serviceId,
          providerId: null,
        };
      } catch (err) {
        throw mapGoogleError(err);
      }
    },

    async cancelBooking(externalBookingId: string): Promise<void> {
      try {
        await calendar.events.delete({ calendarId, eventId: externalBookingId });
      } catch (err) {
        throw mapGoogleError(err);
      }
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function buildDescription(r: BookingRequest): string {
  const lines = [
    `Contact: ${r.contactName}`,
    `Phone: ${r.contactPhoneE164}`,
  ];
  if (r.address) lines.push(`Address: ${r.address}`);
  if (r.problemDescription) lines.push(`Problem: ${r.problemDescription}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);
  lines.push("", "Booked by AI receptionist.");
  return lines.join("\n");
}

/** Pure, unit-testable slot finder. Exported for tests. */
export function computeOpenSlots(input: {
  fromIso: string;
  toIso: string;
  durationMinutes: number;
  busy: ReadonlyArray<{ start: string; end: string }>;
  stepMinutes: number;
  limit: number;
}): AvailabilitySlot[] {
  const start = new Date(input.fromIso).getTime();
  const end = new Date(input.toIso).getTime();
  const dur = input.durationMinutes * 60_000;
  const step = input.stepMinutes * 60_000;

  const busyMs = input.busy.map(
    (b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const,
  );

  const slots: AvailabilitySlot[] = [];
  for (let t = start; t + dur <= end && slots.length < input.limit; t += step) {
    const slotEnd = t + dur;
    const overlaps = busyMs.some(([bs, be]) => t < be && slotEnd > bs);
    if (!overlaps) {
      slots.push({
        start: new Date(t).toISOString(),
        end: new Date(slotEnd).toISOString(),
        providerId: null,
      });
    }
  }
  return slots;
}
