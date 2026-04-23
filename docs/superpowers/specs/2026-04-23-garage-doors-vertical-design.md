# Garage Doors Vertical — Design Spec

**Date:** 2026-04-23
**Status:** Design, pre-implementation
**First tenant:** Fix Garage (owner: Joe, Google account: `fix.garage909@gmail.com`)

## Summary

Extend the Front Desk platform to serve non-medspa verticals without forking the codebase. Introduce a `Vertical` abstraction under `apps/api/src/verticals/`, migrate the existing medspa-specific content into it, and add a second vertical, `garage-doors`, for home-services tenants whose first representative is a garage door repair business.

The agent shape (after-hours SMS + voicemail receptionist that captures requests, books visits, and pages the owner on urgent calls) is unchanged. What differs between verticals is the prompts, classifier taxonomy, tool set, booking adapters, and compliance tier.

## Non-goals

- Forking the codebase into a non-HIPAA variant.
- Weakening RLS, audit triggers, or PII redaction for non-HIPAA tenants; those remain on for everyone.
- MMS photo ingestion from customers.
- Proactive outbound SMS from the owner to the customer.
- Jobber, Housecall Pro, or ServiceTitan booking adapters (future upgrade path).

## Architecture

### `Vertical` abstraction

New module tree:

```
apps/api/src/verticals/
  types.ts              # Vertical interface + registry type
  index.ts              # { medspa, 'garage-doors' } registry
  medspa/
    index.ts            # exports Vertical
    prompts.ts
    classifier.ts
    tools.ts            # tool IDs this vertical's agent may call
    escalation.ts
    compliance.ts       # { level: 'hipaa', baaRequired: true }
    README.md
  garage-doors/
    index.ts
    prompts.ts
    classifier.ts
    tools.ts
    escalation.ts
    compliance.ts       # { level: 'standard', baaRequired: false }
    README.md
```

`Vertical` interface (in `types.ts`):

```ts
export interface Vertical {
  id: 'medspa' | 'garage-doors';
  prompts: { system: string; classifier: string };
  classifier: { categories: readonly string[] };
  escalation: {
    alwaysEscalateCategories: readonly string[];
    escalationTool: ToolId;                      // 'notify_owner' | 'escalate_to_human'
    slaMinutesByUrgency?: Record<string, number>;
  };
  tools: readonly ToolId[];               // subset of TOOL_DEFINITIONS the agent may call
  bookingAdapters: readonly BookingAdapterId[];
  compliance: { level: 'hipaa' | 'standard'; baaRequired: boolean };
}
```

Each `verticals/<id>/index.ts` composes the `Vertical` object from its sibling files: `prompts.ts` → `prompts`, `classifier.ts` → `classifier`, `escalation.ts` → `escalation`, `tools.ts` → `tools`, `compliance.ts` → `compliance`. `id` and `bookingAdapters` are declared inline in `index.ts`.

Medspa content currently in `agent/prompts.ts`, `agent/classifier.ts`, and `agent/tools.ts` moves into `verticals/medspa/`. The orchestrator in `agent/orchestrator.ts` becomes vertical-agnostic and loads `verticals[tenant.vertical]` per request.

Tool **implementations** (function bodies in `agent/tools.ts`'s `runTool`) stay centralized. Each vertical declares which tool IDs its agent may call; the orchestrator gates on that list.

### Database changes

1. New column on `tenants`:
   ```sql
   ALTER TABLE tenants
     ADD COLUMN vertical TEXT NOT NULL DEFAULT 'medspa'
       CHECK (vertical IN ('medspa','garage-doors'));
   ```

2. Expand `booking_adapter` CHECK constraint to include `google-calendar`.

3. Rename PHI-labeled columns to vertical-neutral names (`migrations/002_rename_patient_to_contact.sql`):
   ```sql
   ALTER TABLE conversations RENAME COLUMN patient_phone_hash TO contact_phone_hash;
   ALTER TABLE bookings      RENAME COLUMN patient_name       TO contact_name;
   ALTER TABLE bookings      RENAME COLUMN patient_phone_hash TO contact_phone_hash;
   ```

   Indexes referencing these columns are recreated with the new names. TypeScript types, repositories, tool handlers, and eval fixtures are updated to match. No data transformation needed; it is a pure rename.

4. Audit triggers remain in place; they reference tables, not columns.

### PII module rename

`lib/phi.ts` → `lib/pii.ts`. Same redaction logic (phone, email, DOB, SSN, known sensitive keys). HIPAA is not the reason we redact; it is one compliance tier on top of generic PII hygiene. Medspa-specific policies (stricter retention, BAA requirement) live in `verticals/medspa/compliance.ts` and are read by downstream systems.

### Orchestrator flow (per inbound turn)

1. Resolve `tenant` from the inbound Twilio number.
2. Load `vertical = verticals[tenant.vertical]`.
3. Classify with `vertical.prompts.classifier` and `vertical.classifier.categories`.
4. If `category ∈ vertical.classifier.alwaysEscalateCategories`, the agent is required to call the vertical's escalation tool before `end_conversation` (enforced in the tool-use post-check).
5. Agent runs with `vertical.prompts.system` and tools filtered to `vertical.tools`.
6. Any `create_booking` call routes to the adapter named in `tenant.booking_adapter`, gated to the vertical's allowed adapters.

## The `garage-doors` vertical

### Classifier

Categories: `faq | booking | emergency | complaint | spam`.

Emergency is the vertical's only always-escalate category (see `escalation.ts` below). There is no `clinical` category and no `escalate_to_human` tool; emergency path keeps the customer in-conversation while paging the owner via `notify_owner`.

### Tools

```ts
tools: [
  'search_knowledge',
  'check_availability',
  'create_booking',
  'notify_owner',        // NEW
  'end_conversation',
]
```

### `notify_owner` tool

Signature:

```ts
notify_owner({
  urgency: 'emergency' | 'complaint' | 'fyi',
  summary: string,            // ≤ 160 chars for single-segment SMS
  callbackPhone: string,
  address?: string,
})
```

Behavior:
- Reads owner contact from `tenants.config.owner_contact.phone`.
- Sends SMS via the existing Twilio client.
- Writes an `audit_log` row with `action = 'notify_owner'` and the urgency in metadata.
- Returns a short, declarative outcome to the LLM (e.g., `{ ok: true, sent_to: '+1XXX...' }` with phone redacted in logs).

SMS templates:

| Urgency | Template |
|---|---|
| `emergency` | `🚨 URGENT — {summary}. Callback: {callbackPhone}. Address: {address}. SLA 15min.` |
| `complaint` | `Callback needed — {summary}. From: {callbackPhone}. Address: {address}.` |
| `fyi` | `FYI: {summary}.` |

### System prompt (shape)

Persona: after-hours dispatcher for a garage door repair shop. Friendly, efficient, no fluff; assumes the customer is stressed because their garage is broken.

Hard rules:
- Capture before closing: customer name, callback phone, service address, one-sentence problem description.
- Emergency triggers (car trapped in or out of garage, door won't close for the night, broken spring with immediate safety hazard): call `notify_owner` with `urgency='emergency'` BEFORE `end_conversation`. Confirm to customer that the owner has been paged and will call back within the SLA.
- Never give a firm price. Ballparks from knowledge are fine, always coupled with "we'd want eyes on it to quote firmly — want me to book someone?"
- Never diagnose remotely past "sounds like X, but we'd want to see it."
- Never promise a same-day visit unless the calendar shows it.

### Escalation config

```ts
// verticals/garage-doors/escalation.ts
import type { Vertical } from '../types';

export const escalation: Vertical['escalation'] = {
  alwaysEscalateCategories: ['emergency'],
  escalationTool: 'notify_owner',
  slaMinutesByUrgency: { emergency: 15, complaint: 240, fyi: 1440 },
};
```

The orchestrator enforces: when the classifier returns a category in `alwaysEscalateCategories`, the agent is required to call `escalationTool` before `end_conversation`. This mirrors medspa's existing "clinical always escalates" rule, now expressed through the Vertical interface instead of hardcoded in the orchestrator.

### Compliance

`{ level: 'standard', baaRequired: false }`. RLS, audit triggers, and PII redaction remain on. Retention defaults to 2 years (vs. 7 for medspa). No BAA signed with tenant.

### Tenant config shape (stored in `tenants.config` JSONB)

```json
{
  "owner_contact": { "name": "Joe", "phone": "+1XXXXXXXXXX" },
  "timezone": "America/Phoenix",
  "business_hours": {
    "mon": "8-18", "tue": "8-18", "wed": "8-18",
    "thu": "8-18", "fri": "8-18", "sat": "9-15", "sun": "closed"
  },
  "service_area_zips": ["85301", "85302"],
  "sla_minutes": { "emergency": 15, "complaint": 240, "fyi": 1440 }
}
```

## Google Calendar booking adapter

New file: `apps/api/src/integrations/booking/google-calendar.ts`. Implements the existing `BookingAdapter` interface — no interface change. Registered in `integrations/booking/index.ts`'s `createBookingAdapter` factory. Uses the official `googleapis` npm package.

### Operations

- `checkAvailability({ startISO, endISO, durationMinutes })` — calls `calendar.freebusy.query` on the primary calendar of the authenticated account, intersects the free windows with `tenant.config.business_hours` and `tenant.config.timezone`, returns candidate slots of the requested duration.
- `createBooking({ service, startISO, endISO, contactName, contactPhone, address, problemDescription })` — calls `calendar.events.insert`:
  - Title: `[Service Call] {contactName} — {problem, ≤ 40 chars}`
  - Description: full contact info, address, full problem description, marker `Booked by AI receptionist`.
  - Location: customer address.
  - Start / end in the tenant's timezone.
  - Returns the Google event ID, stored in `bookings.external_booking_id`.
- `cancelBooking(externalId)` — `calendar.events.delete`.

### Credentials and OAuth

Scopes requested: `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.readonly` (for freebusy).

Credentials stored in AWS Secrets Manager under `${tenant_id}/booking/google-calendar`:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```

The adapter instantiates a `google.auth.OAuth2` client with the secret, sets the refresh token, and relies on the client to auto-refresh access tokens. `tenants.booking_credentials_secret_arn` holds the ARN.

### One-time OAuth script

New script: `scripts/connect-google-calendar.ts`, invoked as `pnpm connect:google-calendar -- --tenant <id>`. Flow:

1. Opens the Google OAuth consent URL in the default browser with `access_type=offline` and `prompt=consent` (to guarantee a refresh token).
2. Spins up a temporary localhost HTTP server on a fixed port (the port is registered in the Google Cloud OAuth client's authorized redirect URIs).
3. Receives the authorization code on the redirect.
4. Exchanges the code for `{ access_token, refresh_token, expiry_date }`.
5. Writes `{ client_id, client_secret, refresh_token }` to Secrets Manager (or the local dev secret store).
6. Updates `tenants.booking_adapter = 'google-calendar'` and `tenants.booking_credentials_secret_arn`.
7. Prints "Connected. You can close this window."

For Joe's tenant, this is run once pointed at `fix.garage909@gmail.com`. Refresh tokens do not expire unless revoked or unused for 6 months.

## Onboarding

Extend `scripts/seed-tenant.ts` to accept `--vertical <id>` and the vertical's required config fields. Single-command onboarding for Joe's tenant:

```bash
pnpm db:seed -- \
  --name "Fix Garage" \
  --twilio "+1XXXXXXXXXX" \
  --vertical garage-doors \
  --timezone America/Phoenix \
  --owner-phone "+1XXXXXXXXXX" \
  --url https://fix.garage909.com
```

Then:

```bash
pnpm connect:google-calendar -- --tenant <tenant_id>
```

The `--url` flag reuses the existing RAG ingest pipeline unchanged — it scrapes the site, chunks, embeds, and writes to `knowledge_chunks` for the new tenant.

**Data required from Joe before seeding:**

- Twilio number to assign (we purchase and point at `/twilio/sms` and `/twilio/voice`)
- Joe's cell phone number
- Timezone (assumed America/Phoenix)
- Business hours
- Service area zip codes
- Public website URL, or a plain-text services-and-pricing doc if he has no website

## Dashboard changes

Scoped and minimal. Introduce `useVerticalLabels(tenant)` returning `{ contactLabel, categories }`:
- `contactLabel`: `"Customer"` for `garage-doors`, `"Patient"` for `medspa`.
- `categories`: the classifier category list from the tenant's vertical.

Applied to:
- The conversations table column headers.
- The category filter dropdown.

No routing, schema, or data-shape changes in the dashboard.

## Evaluation

New scenarios under `packages/eval/scenarios/garage-doors/`:

1. **`faq-and-booking`** — "Do you service 85301? How much for a spring?" → answer from knowledge + offer to book → customer accepts a proposed slot → `create_booking` invoked → assertions: booking row written, conversation status = `booked`, Calendar mock received an `events.insert`.
2. **`emergency`** — "Door is stuck open and I'm leaving in 20 minutes." → classifier returns `emergency` → agent captures details → `notify_owner` invoked with `urgency='emergency'` BEFORE `end_conversation` → assertions: tool sequence correct, audit row `action='notify_owner'` exists, outcome returned to LLM does not leak the owner's phone in plaintext.
3. **`complaint`** — "Your tech came Tuesday and it's broken again." → classifier returns `complaint` → `notify_owner(complaint)` + callback visit offered → assertions: notify tool fired, optional booking created if customer opts in.
4. **`cross-vertical-isolation`** — An inbound formatted as a garage-doors request is delivered to a medspa tenant's Twilio number. Assert the classifier uses medspa's categories, the orchestrator loads medspa's prompts and tools, and `notify_owner` is not in the tool list. Proves vertical is driven by `tenants.vertical`, not message content.
5. **`spam`** — Marketing spam body. Classifier returns `spam`; conversation ends silently with no notifications.

The existing cross-tenant leak test is extended to cover the new tenant.

## Rollout plan

Each step is independently shippable and passes evals before the next begins.

1. **Platform plumbing.** Add `Vertical` interface, move medspa content into `verticals/medspa/`, add `tenants.vertical` column, rename `patient_*` columns, rename `lib/phi.ts` → `lib/pii.ts`. Medspa continues to work end-to-end. Existing eval scenarios pass unchanged.
2. **Garage-doors vertical (mock booking).** Add `verticals/garage-doors/`, `notify_owner` tool, garage-doors classifier and prompts. Use the `mock` booking adapter. Add eval scenarios 1–5 against the mock.
3. **Google Calendar adapter.** Implement the adapter, the OAuth connect script, and the secrets-manager integration. Swap scenario 1's expected adapter to `google-calendar` behind a test fixture that stubs Google API calls.
4. **Seed Joe's tenant.** Run the seed command, the OAuth script pointed at `fix.garage909@gmail.com`, and ingest his website into `knowledge_chunks`.
5. **Dashboard labels.** Add `useVerticalLabels` and apply to headers and filters.
6. **Go live.** Buy the Twilio number, point it at Joe's tenant, monitor the first week of real conversations closely.

## Open questions

- **Service-area enforcement:** does the agent turn away callers outside the service-area zips, or capture and let Joe decide? (Default: capture, flag to Joe via `fyi` notification.)
- **Quote knowledge:** does Joe have a public pricing page to scrape, or will he give us a plain-text price sheet? (Affects knowledge ingestion for scenario 1.)
- **Business hours rigor:** is the calendar check strict (never book outside business hours) or soft (prefer business hours, allow overflow if Joe has free time on the calendar)? Default: strict.

## Deferred

- MMS photos of the customer's garage door (Twilio supports receiving MMS; agent does not use images yet).
- Proactive outbound SMS from Joe to the customer ("running late", "on the way").
- Jobber / Housecall Pro adapters as upgrade paths once Joe outgrows a plain calendar.
- Generalizing `garage-doors` into a broader `home-services` vertical. Revisit when the second non-medspa client signs on; until then, the narrow name stays.
