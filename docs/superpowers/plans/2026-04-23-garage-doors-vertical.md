# Implementation plan: garage-doors vertical

**Spec:** `docs/superpowers/specs/2026-04-23-garage-doors-vertical-design.md`
**Date:** 2026-04-23
**First tenant:** Fix Garage (owner: Joe, Google account `fix.garage909@gmail.com`)

## Goal

Extend the Front Desk platform to serve a garage-doors business as a second vertical. One codebase, no fork. Medspa behavior must be byte-for-byte unchanged at the eval harness level after each phase.

## Success criteria

- `pnpm test` and `pnpm eval` pass with both verticals represented.
- A `tenants.vertical = 'garage-doors'` row routes inbound SMS through garage-doors prompts, classifier categories, tool set, and escalation (via `notify_owner`).
- Google Calendar adapter creates real events on `fix.garage909@gmail.com`'s primary calendar from a successful booking turn.
- Emergency classification forces the agent to call `notify_owner` with `urgency='emergency'` before `end_conversation`, enforced by the orchestrator (not relying on prompt compliance alone).
- Existing medspa flow (Aurora Med Spa seed) runs end-to-end with no behavior change.

## Out of scope

- Dashboard routing/schema changes beyond relabeling.
- Boulevard/Vagaro adapters — untouched.
- MMS photo ingestion, proactive outbound SMS, Jobber/Housecall Pro adapters.
- Generalizing `garage-doors` into a `home-services` umbrella.

## Invariants (from CLAUDE.md)

- RLS on every PHI table; every query runs in `withTenant()`. Rename does not weaken this.
- PII redaction remains on for ALL tenants (HIPAA is a level on top of generic PII hygiene, not a trigger for it).
- All LLM traffic through AWS Bedrock. Google Calendar API is not a model call.
- Audit triggers preserved through the `patient_*` → `contact_*` rename (triggers are table-scoped, column-agnostic).

---

## Phase 1 — Platform plumbing

Goal: reshape the codebase so both verticals fit, without changing medspa behavior. Every commit in this phase must leave `pnpm eval` green for existing medspa scenarios.

### Task 1 — Add a forward-only migration runner

**New files:** `apps/api/src/db/migrate.ts`, `apps/api/src/db/migrations/` (empty dir with `.gitkeep`).
**Modified:** `package.json` (root) — add `"db:migrate": "tsx apps/api/src/db/migrate.ts"`.

```ts
// apps/api/src/db/migrate.ts
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unscoped, closePool } from "./client.js";
import { logger } from "../lib/logger.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export async function migrate() {
  await unscoped(async (c) => {
    await c.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  });

  const done = await unscoped(async (c) => {
    const res = await c.query(`SELECT id FROM schema_migrations`);
    return new Set(res.rows.map((r) => r.id as string));
  });

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const id = f.replace(/\.sql$/, "");
    if (done.has(id)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    await unscoped(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
        await c.query("COMMIT");
        logger.info({ migration: id }, "migration applied");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .catch((e) => {
      logger.error({ err: e }, "migration failed");
      process.exit(1);
    })
    .finally(closePool);
}
```

**Verify:** `pnpm db:migrate` on a DB with the base `schema.sql` already applied prints nothing, exits 0.

### Task 2 — Migration `001_add_vertical_column.sql`

**New file:** `apps/api/src/db/migrations/001_add_vertical_column.sql`
**Also:** mirror into `apps/api/src/db/schema.sql` so fresh docker-compose setups line up.

```sql
BEGIN;

ALTER TABLE tenants
  ADD COLUMN vertical TEXT NOT NULL DEFAULT 'medspa'
  CHECK (vertical IN ('medspa','garage-doors'));

-- Drop the default so new inserts must be explicit.
ALTER TABLE tenants
  ALTER COLUMN vertical DROP DEFAULT;

COMMIT;
```

`schema.sql` edit: add the column without the transient default (matching post-migration state):
```sql
vertical TEXT NOT NULL CHECK (vertical IN ('medspa','garage-doors')),
```

**Verify:** existing rows get `'medspa'`; new tenants must pass `vertical`.

### Task 3 — Migration `002_rename_patient_to_contact.sql`

**New file:** `apps/api/src/db/migrations/002_rename_patient_to_contact.sql`
**Also:** mirror into `schema.sql`.

```sql
BEGIN;

ALTER TABLE conversations
  RENAME COLUMN patient_phone_hash TO contact_phone_hash;

ALTER TABLE bookings
  RENAME COLUMN patient_name TO contact_name;
ALTER TABLE bookings
  RENAME COLUMN patient_phone_hash TO contact_phone_hash;

-- Rename the index to match
ALTER INDEX IF EXISTS conversations_tenant_phone_idx
  RENAME TO conversations_tenant_contact_idx;

COMMIT;
```

`schema.sql` updates: `patient_phone_hash` → `contact_phone_hash`, `patient_name` → `contact_name`, index name updated. Audit triggers need no change (they're table-scoped).

**Verify:** `\d conversations` shows `contact_phone_hash`; `\d bookings` shows `contact_name`, `contact_phone_hash`; index renamed.

### Task 4 — Migration `003_expand_booking_adapter_check.sql`

**New file:** `apps/api/src/db/migrations/003_expand_booking_adapter_check.sql`
**Also:** update `schema.sql`.

```sql
BEGIN;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_booking_adapter_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_booking_adapter_check
  CHECK (booking_adapter IN ('mock','boulevard','vagaro','google-calendar'));
COMMIT;
```

### Task 5 — Rename `lib/phi.ts` → `lib/pii.ts`

**Move:** `apps/api/src/lib/phi.ts` → `apps/api/src/lib/pii.ts`.
**Modified imports** (exhaustive grep for `lib/phi`):
- `apps/api/src/agent/tools.ts`
- `apps/api/src/agent/orchestrator.ts`
- `apps/api/src/routes/*.ts` (whichever files import `hashPhone` or `redact`)
- `apps/api/src/db/repository.ts` (if any)
- `packages/eval/src/harness.ts`

Same exports (`redact`, `hashPhone`), same logic. Broaden `SENSITIVE_KEYS`:

```ts
const SENSITIVE_KEYS = new Set([
  "phone", "phoneE164", "patientPhone", "patientPhoneE164",
  "contactPhone", "contactPhoneE164", "callbackPhone",
  "email", "name", "patientName", "contactName",
  "address", "streetAddress",
  "dob", "dateOfBirth", "ssn",
]);
```

**Verify:** `pnpm --filter @medspa/api build`. `grep -r "lib/phi" apps packages scripts` returns zero hits.

### Task 6 — Rename `patient*` fields in `packages/shared/src/conversation.ts`

- `Conversation.patientPhoneHash` → `contactPhoneHash`.
- `MessageRole` zod enum: add `"contact"` alongside `"patient"`. Keep `"patient"` for existing rows. Old medspa inbound writes continue to use `"patient"` through Phase 2; garage-doors writes use `"contact"` once Phase 2 lands.

### Task 7 — Rename `patient*` fields in `packages/shared/src/booking.ts`

```ts
export const bookingRequestSchema = z.object({
  serviceId: z.string(),
  start: z.string().datetime(),
  contactName: z.string().min(1),
  contactPhoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  providerId: z.string().nullable().default(null),
  notes: z.string().default(""),
  // Optional; used by garage-doors bookings.
  address: z.string().optional(),
  problemDescription: z.string().optional(),
});
```

`bookingResultSchema` stays put — no patient fields to rename.

### Task 8 — Loosen/extend `packages/shared/src/tenant-config.ts`

- `services: z.array(serviceSchema).min(1)` → `services: z.array(serviceSchema).default([])`.
- Extend `escalationRuleSchema` with optional fields:
  ```ts
  ownerName: z.string().optional(),
  slaMinutesByUrgency: z
    .object({
      emergency: z.number().int().positive().default(15),
      complaint: z.number().int().positive().default(240),
      fyi: z.number().int().positive().default(1440),
    })
    .optional(),
  ```
- Add optional top-level `serviceAreaZips: z.array(z.string()).optional()` for garage-doors service-area enforcement.

Medspa config defaults are unchanged; these are all optional additions or widenings.

### Task 9 — Extend `Intent` in `packages/shared/src/agent.ts`

```ts
export const intentSchema = z.enum([
  "faq",
  "booking",
  "clinical",     // medspa only
  "emergency",    // garage-doors only
  "complaint",
  "spam",
]);
```

The orchestrator clamps classifier output to `vertical.classifier.categories` at runtime, so the extended enum doesn't affect medspa behavior.

### Task 10 — Update `db/repository.ts` for `contact_*` columns + `vertical`

- All SQL: `patient_phone_hash` → `contact_phone_hash`, `patient_name` → `contact_name`.
- `TenantRow` gains `vertical: "medspa" | "garage-doors"`.
- Every `SELECT ... FROM tenants ...` adds the `vertical` column.
- `insertTenant(input)`: add `vertical` to the signature and SQL.
- `rowToTenant` reads `r.vertical`.
- `findOrCreateConversation(input)`: rename `input.patientPhoneHash` → `input.contactPhoneHash`.
- `insertBooking(input)`: rename `input.patientName` → `input.contactName`, `input.patientPhoneHash` → `input.contactPhoneHash`.
- `listBookings` return shape: `patientName` → `contactName`.
- `rowToConversation`: `patientPhoneHash` → `contactPhoneHash`.

### Task 11 — Update all call sites (grep-driven)

**Files (expect non-trivial diff):**
- `apps/api/src/agent/tools.ts` — `ToolContext.patientPhoneE164` → `contactPhoneE164`; `create_booking` tool schema `patient_name` → `contact_name`; `createBooking` handler passes `contactName`, `contactPhoneE164`; `insertBooking(input)` uses `contactName`/`contactPhoneHash`.
- `apps/api/src/agent/orchestrator.ts` — `OrchestrateInput.patientPhoneE164` → `contactPhoneE164`; pass through into `ToolContext`.
- `apps/api/src/agent/prompts.ts` — any literal `patient_name` in medspa prompt text becomes `contact_name` (so the medspa model emits the new param name — still the same human concept for patients).
- `apps/api/src/integrations/booking/mock.ts` — idempotency key string `patientPhoneE164` → `contactPhoneE164`.
- `apps/api/src/integrations/booking/boulevard.ts`, `vagaro.ts` (if they have stubs referencing the old names).
- `apps/api/src/routes/twilio.ts` (or whichever file handles the SMS webhook) — rename local `patientPhoneE164` → `contactPhoneE164`.
- `packages/eval/src/harness.ts` — `phi.js` import → `pii.js`; `patientPhoneHash` → `contactPhoneHash`.
- `packages/eval/src/scenarios.ts` — any scenario referencing those names directly.
- `scripts/seed-tenant.ts` — no patient refs currently, but add `vertical` to the INSERT in Task 34.

**TypeScript `strict` + `noUncheckedIndexedAccess` will catch most misses at compile time.** If a test file references `patientName` in assertions, update those too.

### Task 12 — Verify Phase 1

```
pnpm db:migrate
pnpm build
pnpm test
pnpm eval     # medspa scenarios — zero regressions
```

**Commit:** `refactor: add vertical column, rename patient→contact, phi→pii`

---

## Phase 2 — Vertical abstraction + garage-doors vertical + `notify_owner`

Every commit here still keeps medspa green. The orchestrator's hardcoded `intent === 'clinical'` short-circuit becomes vertical-driven.

### Task 13 — `Vertical` interface

**New file:** `apps/api/src/verticals/types.ts`

```ts
import type { Intent } from "@medspa/shared";

export type VerticalId = "medspa" | "garage-doors";
export type ToolId =
  | "search_knowledge"
  | "check_availability"
  | "create_booking"
  | "escalate_to_human"
  | "notify_owner"
  | "end_conversation";
export type BookingAdapterId = "mock" | "boulevard" | "vagaro" | "google-calendar";

export interface Vertical {
  id: VerticalId;
  prompts: { system: string; classifier: string };
  classifier: { categories: ReadonlyArray<Intent> };
  escalation: {
    /** Intents that MUST trigger an escalation tool call before end_conversation. */
    alwaysEscalateCategories: ReadonlyArray<Intent>;
    /** The tool the agent calls to escalate. */
    escalationTool: Extract<ToolId, "escalate_to_human" | "notify_owner">;
    /** Vertical-specific SLA map (minutes), used by the escalation tool body. */
    slaMinutesByUrgency?: Record<string, number>;
  };
  tools: ReadonlyArray<ToolId>;
  bookingAdapters: ReadonlyArray<BookingAdapterId>;
  compliance: { level: "hipaa" | "standard"; baaRequired: boolean };
}
```

### Task 14 — Medspa vertical (extract existing content)

**New dir:** `apps/api/src/verticals/medspa/`

Files:
- `prompts.ts` — exports `const system: string` and `const classifier: string`, copied verbatim from the current `agent/prompts.ts`. The `{{displayName}}`/`{{voiceTone}}` placeholders (or whatever the current code uses) stay in the string; interpolation happens in `agent/prompts.ts`'s builder (Task 18).
- `classifier.ts` — `export const classifier = { categories: ["faq","booking","clinical","complaint","spam"] as const };`
- `tools.ts` — `export const tools = ["search_knowledge","check_availability","create_booking","escalate_to_human","end_conversation"] as const;` (matches the vertical's current tool exposure exactly).
- `escalation.ts`:
  ```ts
  import type { Vertical } from "../types.js";
  export const escalation: Vertical["escalation"] = {
    alwaysEscalateCategories: ["clinical"],
    escalationTool: "escalate_to_human",
  };
  ```
- `compliance.ts`:
  ```ts
  import type { Vertical } from "../types.js";
  export const compliance: Vertical["compliance"] = { level: "hipaa", baaRequired: true };
  ```
- `README.md` — 3-paragraph doc describing what this vertical models and what's vertical-specific vs platform.
- `index.ts`:
  ```ts
  import type { Vertical } from "../types.js";
  import { system, classifier as classifierPrompt } from "./prompts.js";
  import { classifier } from "./classifier.js";
  import { tools } from "./tools.js";
  import { escalation } from "./escalation.js";
  import { compliance } from "./compliance.js";

  export const medspa: Vertical = {
    id: "medspa",
    prompts: { system, classifier: classifierPrompt },
    classifier,
    escalation,
    tools,
    bookingAdapters: ["mock", "boulevard", "vagaro"],
    compliance,
  };
  ```

### Task 15 — Garage-doors vertical

**New dir:** `apps/api/src/verticals/garage-doors/`

Mirror medspa's file layout. Contents:

`prompts.ts` — `system` string built around the spec's persona and hard rules:
> After-hours dispatcher for a garage-door repair business. Friendly, efficient, no fluff; assumes the customer is stressed. Hard rules: capture name + callback + address + one-sentence problem before ending; emergency triggers (stuck open/closed, car trapped, broken spring with safety hazard) MUST call `notify_owner` with `urgency='emergency'` before `end_conversation`, then tell the caller the owner has been paged and will call back within 15 min; no firm prices — ballparks only with "we'd want eyes on it to quote"; no same-day promises unless the calendar shows it; if caller's ZIP is outside `tenantConfig.serviceAreaZips` (and the list is non-empty), capture and send `notify_owner({urgency: "fyi", ...})` so the owner can decide. Tone: `{{voiceTone}}`. Business name: `{{displayName}}`.

`classifier` prompt string — "Classify the inbound message into exactly one of: `faq | booking | emergency | complaint | spam`. Return only the category word." Short and deterministic.

`classifier.ts`:
```ts
export const classifier = {
  categories: ["faq","booking","emergency","complaint","spam"] as const,
};
```

`tools.ts`:
```ts
export const tools = [
  "search_knowledge",
  "check_availability",
  "create_booking",
  "notify_owner",
  "end_conversation",
] as const;
```

`escalation.ts`:
```ts
import type { Vertical } from "../types.js";
export const escalation: Vertical["escalation"] = {
  alwaysEscalateCategories: ["emergency"],
  escalationTool: "notify_owner",
  slaMinutesByUrgency: { emergency: 15, complaint: 240, fyi: 1440 },
};
```

`compliance.ts`:
```ts
import type { Vertical } from "../types.js";
export const compliance: Vertical["compliance"] = { level: "standard", baaRequired: false };
```

`index.ts`:
```ts
import type { Vertical } from "../types.js";
import { system, classifier as classifierPrompt } from "./prompts.js";
import { classifier } from "./classifier.js";
import { tools } from "./tools.js";
import { escalation } from "./escalation.js";
import { compliance } from "./compliance.js";

export const garageDoors: Vertical = {
  id: "garage-doors",
  prompts: { system, classifier: classifierPrompt },
  classifier,
  escalation,
  tools,
  bookingAdapters: ["mock", "google-calendar"],
  compliance,
};
```

`README.md` — doc with the "emergency ⇒ notify_owner before end_conversation" rule spelled out, since it's the sharpest behavioral departure from medspa.

### Task 16 — Vertical registry

**New file:** `apps/api/src/verticals/index.ts`

```ts
import type { Vertical, VerticalId } from "./types.js";
import { medspa } from "./medspa/index.js";
import { garageDoors } from "./garage-doors/index.js";

export const VERTICALS: Record<VerticalId, Vertical> = {
  "medspa": medspa,
  "garage-doors": garageDoors,
};

export function getVertical(id: VerticalId): Vertical {
  const v = VERTICALS[id];
  if (!v) throw new Error(`unknown vertical: ${id}`);
  return v;
}

export type { Vertical, VerticalId, ToolId, BookingAdapterId } from "./types.js";
```

### Task 17 — Add `notify_owner` tool to `TOOL_DEFINITIONS`

**Modified:** `apps/api/src/agent/tools.ts`

Append:

```ts
{
  name: "notify_owner",
  description:
    "Page the business owner via SMS. Use for emergencies (stuck door, safety hazard, car trapped), complaints about prior work, or informational heads-up (out-of-area caller). Always call this BEFORE end_conversation when the classifier flagged the intent as an always-escalate category.",
  input_schema: {
    type: "object",
    properties: {
      urgency: { type: "string", enum: ["emergency", "complaint", "fyi"] },
      summary: {
        type: "string",
        description: "One sentence, ≤160 chars. Enough for the owner to decide how fast to call back.",
      },
      callbackPhone: {
        type: "string",
        description: "E.164 callback number for the caller.",
      },
      address: { type: "string", description: "Street address (required for emergency, optional otherwise)." },
    },
    required: ["urgency", "summary", "callbackPhone"],
    additionalProperties: false,
  },
},
```

Add a `runTool` branch:

```ts
case "notify_owner":
  return notifyOwnerTool(ctx, input);
```

And the handler (same file or sibling `tools/notify-owner.ts`):

```ts
async function notifyOwnerTool(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutput> {
  const parsed = notifyOwnerInputSchema.parse(input);
  // Delegate to the same infra the existing escalate path uses.
  const body = buildOwnerAlertBody({
    tenantName: ctx.tenantConfig.displayName,
    urgency: parsed.urgency,
    summary: parsed.summary,
    callbackPhone: parsed.callbackPhone,
    address: parsed.address,
    slaMinutes: ctx.tenantConfig.escalation.slaMinutesByUrgency?.[parsed.urgency],
  });
  // notifyOwner already handles Twilio send + error swallowing (same fn already on ToolContext).
  await ctx.notifyOwner(body, parsed.urgency).catch(() => {});
  await auditWithin(ctx.client, {
    tenantId: ctx.tenantId,
    actor: "agent",
    action: "notify_owner",
    resourceType: "conversation",
    resourceId: ctx.conversationId,
    metadata: {
      urgency: parsed.urgency,
      // Redact the summary body before storing — tool-side belt-and-suspenders.
      summary: redact(parsed.summary),
    },
  });
  if (parsed.urgency !== "fyi") {
    await updateConversationStatus(ctx.client, ctx.conversationId, "escalated");
  }
  return {
    content: `OWNER_PAGED urgency=${parsed.urgency}. Acknowledge the caller and tell them the owner will call back shortly.`,
    isError: false,
    outcome: parsed.urgency === "fyi" ? undefined : "escalated",
  };
}
```

`notifyOwnerInputSchema`, `buildOwnerAlertBody`, and the SMS templates from the spec's table live in `apps/api/src/agent/owner-alert.ts` (new sibling file to keep `tools.ts` focused).

SMS templates (per spec):
```
emergency: 🚨 URGENT — {summary}. Callback: {callbackPhone}. Address: {address}. SLA {slaMinutes}min.
complaint: Callback needed — {summary}. From: {callbackPhone}. Address: {address}.
fyi:       FYI: {summary}.
```

Add `getToolDefinitions(ids: ReadonlyArray<ToolId>)` exported from `tools.ts`:
```ts
export function getToolDefinitions(ids: ReadonlyArray<ToolId>): AnthropicTool[] {
  const set = new Set(ids);
  return TOOL_DEFINITIONS.filter((t) => set.has(t.name as ToolId));
}
```

### Task 18 — Thin `agent/prompts.ts`

**Modified:** `apps/api/src/agent/prompts.ts`

Remove the inlined medspa strings (now in `verticals/medspa/prompts.ts`). Replace with builders driven by a `Vertical`:

```ts
import type { Vertical } from "../verticals/types.js";
import type { TenantConfig } from "@medspa/shared";

export function buildSystemPrompt(args: {
  vertical: Vertical;
  tenant: { name: string; config: TenantConfig };
  nowIso: string;
}): string {
  return args.vertical.prompts.system
    .replaceAll("{{displayName}}", args.tenant.config.displayName)
    .replaceAll("{{voiceTone}}", args.tenant.config.voice.tone)
    .replaceAll("{{nowIso}}", args.nowIso);
}

export function buildClassifierPrompt(args: { vertical: Vertical }): string {
  return args.vertical.prompts.classifier;
}
```

### Task 19 — Refactor `agent/classifier.ts`

**Modified:** `apps/api/src/agent/classifier.ts`

Replace the hardcoded category list with the vertical's `categories`, and remove the "default to clinical on parse failure" safety net (which was medspa-specific). Default to a vertical-supplied fallback instead.

```ts
export async function classifyIntent(args: {
  message: string;
  vertical: Vertical;
  /** Returned if the model output isn't in the vertical's category set. */
  fallback: Intent;
}): Promise<Intent> {
  const res = await invokeClaude({
    modelId: classifierModelId(),
    system: buildClassifierPrompt({ vertical: args.vertical }),
    maxTokens: 8,
    temperature: 0,
    messages: [{ role: "user", content: args.message }],
  });
  const text = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text).join("").toLowerCase().trim();
  const categories = args.vertical.classifier.categories;
  for (const cat of categories) {
    if (text.startsWith(cat)) return cat;
  }
  return args.fallback;
}
```

Fallback choice: the orchestrator passes the safety-biased value per vertical (medspa → `"clinical"` to preserve the existing bias; garage-doors → `"faq"`).

### Task 20 — Refactor `agent/orchestrator.ts`

**Modified:** `apps/api/src/agent/orchestrator.ts`

Key changes:

1. `OrchestrateInput` adds `vertical: Vertical`. The webhook caller derives it via `getVertical(tenant.vertical)`.
2. `insertMessage` for the inbound turn: role is `"contact"` when `vertical.id === "garage-doors"`, `"patient"` when `"medspa"`. (This is why migration `003` is NOT needed — wait, it IS needed. The schema CHECK on `messages.role` currently only allows `patient,assistant,system,tool`. Add a migration in Phase 1.)

   **Insert a new Task 3.5 in Phase 1** (retroactively — Task 3.5 below), or equivalently add migration `004_allow_contact_role.sql`:
   ```sql
   BEGIN;
   ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
   ALTER TABLE messages
     ADD CONSTRAINT messages_role_check
     CHECK (role IN ('patient','contact','assistant','system','tool'));
   COMMIT;
   ```
   And update `schema.sql`. **(Execution order: apply this before Phase 2 ships.)**

3. Replace the hardcoded `if (intent === "clinical")` short-circuit with a vertical-driven path:
   ```ts
   const mustEscalate = input.vertical.escalation.alwaysEscalateCategories.includes(intent);
   if (mustEscalate) {
     // medspa: skip LLM, do the existing auto-escalate short-circuit;
     // garage-doors: do NOT skip LLM — we need the agent to collect details
     //   (name, callback, address) and call notify_owner with specifics.
     if (input.vertical.escalation.escalationTool === "escalate_to_human") {
       // existing medspa auto-escalate flow (clinical): notify owner, write
       // escalated status, return a canned reply. Keep the exact current behavior.
     }
     // For escalationTool === "notify_owner" (garage-doors emergency), we fall
     // through into the LLM loop but ENFORCE the tool-use post-check below.
   }
   ```

4. Tool list to Bedrock: `tools: getToolDefinitions(input.vertical.tools)`.
5. **Tool-use post-check (new):** after the LLM loop exits, if `mustEscalate && input.vertical.escalation.escalationTool === "notify_owner"` and no `notify_owner` call fired, force one (`urgency: "emergency"` for `emergency` category, `"complaint"` for `complaint`) with a `summary` built from the last user message (redacted via `pii.redact`). This enforces the spec's "MUST call escalationTool before end_conversation" rule at the orchestrator level, not just the prompt level.
6. Classifier call site: `classifyIntent({ message: input.inboundText, vertical: input.vertical, fallback: input.vertical.id === "medspa" ? "clinical" : "faq" })`.
7. Pass `buildSystemPrompt({ vertical, tenant, nowIso })`.
8. The `insertMessage` role value at the start: derive from `vertical.id`.

### Task 21 — Plumb `vertical` through the webhook routes

**Modified:** `apps/api/src/routes/twilio.ts` (and whichever admin routes simulate conversations).

After loading the tenant, call `const vertical = getVertical(tenant.vertical)` and pass it into `orchestrate()`.

### Task 22 — Extend the eval harness

**Modified:** `packages/eval/src/harness.ts`

- Add `vertical: VerticalId` to the scenario type.
- When seeding the scenario's tenant, INSERT with the declared `vertical`.
- When calling `orchestrate`, look up the tenant's vertical from the row (not from the scenario) — this catches bugs where the orchestrator doesn't read the column.

### Task 23 — Tag existing medspa scenarios

**Modified:** `packages/eval/src/scenarios.ts`

Add `vertical: "medspa"` to every existing scenario. No other changes.

### Task 24 — Add garage-doors eval scenarios

**New file:** `packages/eval/src/scenarios/garage-doors.ts`, imported from `scenarios.ts`.

Scenarios (match spec §Evaluation exactly):

1. **`garage-faq-and-booking`** — Inbound: "Do you service 85301? How much for a spring replacement?" Expectation: agent answers from knowledge (after RAG hit); on customer accepting a proposed slot, `create_booking` fires. Asserts: booking row written, conversation `status = 'booked'`, mock booking adapter saw `createBooking` with the service id `"service_call"` (or whatever default the garage-doors seed provisions).
2. **`garage-emergency`** — Inbound: "Door is stuck wide open and I'm leaving in 20 minutes, car is trapped." Expectations: classifier → `emergency`; agent collects name/callback/address; `notify_owner` called with `urgency='emergency'` BEFORE `end_conversation`. Asserts: tool call order (`notify_owner` index < `end_conversation` index), `audit_log` row with `action='notify_owner'` and `urgency='emergency'`, owner phone never appears in the LLM-visible tool output (redacted).
3. **`garage-complaint`** — Inbound: "Your tech came Tuesday and my opener is still broken, this is ridiculous." Expectations: `notify_owner(urgency='complaint')`; agent does NOT unilaterally book — it offers a callback visit. Asserts: notify tool fires, no `create_booking` unless the scenario continues with customer opt-in (two-turn scenario).
4. **`garage-cross-vertical-isolation`** — Inbound delivered to a *medspa* tenant's Twilio number but with garage-door content ("My door is stuck open"). Asserts: classifier ran with medspa categories (observable via the audit log's `classifier_decision` row — intent is one of `faq|booking|clinical|complaint|spam`, NOT `emergency`); tool list passed to Bedrock did not include `notify_owner` (assert via a harness hook that captures `invokeClaude` args); no garage-doors prompt strings appear in the system prompt.
5. **`garage-spam`** — Inbound: a solar pitch. Asserts: classifier returns `spam`; conversation ends with no `notify_owner`, no `create_booking`.

Each scenario exports `{ id, vertical: "garage-doors", tenantSeed: { ... }, turns: [...], assertions: [...] }` — match the existing medspa scenario shape.

### Task 25 — Default `service_call` service for garage-doors

The current `create_booking` tool resolves `ctx.tenantConfig.services.find(s => s.id === input.service_id)` and errors if missing. The garage-doors vertical has no service menu but still needs to book.

**Fix (in the seed config, not the tool):** provision a single synthetic service for every garage-doors tenant:

```ts
services: [
  {
    id: "service_call",
    name: "Service call",
    description: "Diagnosis + on-site work, typically 60 min.",
    durationMinutes: 60,
    priceCents: 0,         // final quote on site
    providerTags: [],
    requiresConsult: false,
  },
],
```

No code change to the tool — just the garage-doors seed and the garage-doors system prompt, which tells the model "always pass `service_id: 'service_call'` to `check_availability` and `create_booking`."

### Task 26 — Verify Phase 2

```
pnpm db:migrate           # picks up migration 004 (messages.role)
pnpm build
pnpm test
pnpm eval                 # medspa (unchanged) + 5 garage-doors scenarios
```

**Commit:** `feat: Vertical abstraction, garage-doors vertical, notify_owner tool`

---

## Phase 3 — Google Calendar booking adapter

### Task 27 — Add dependency

`apps/api/package.json`: `"googleapis": "^144.0.0"`. Run `pnpm install`.

### Task 28 — Adapter implementation

**New file:** `apps/api/src/integrations/booking/google-calendar.ts`

```ts
import { google, type calendar_v3 } from "googleapis";
import type {
  BookingAdapter,
  BookingAdapterContext,
} from "./types.js";
import { BookingAdapterError } from "./types.js";
import type {
  AvailabilitySlot,
  BookingRequest,
  BookingResult,
} from "@medspa/shared";
import { logger } from "../../lib/logger.js";

export interface GoogleCalendarCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export interface GoogleCalendarAdapterConfig {
  calendarId: string;    // typically "primary" or the owner's email
  timezone: string;      // from tenant.config.timezone
}

export function createGoogleCalendarAdapter(
  ctx: BookingAdapterContext,
): BookingAdapter {
  const creds = ctx.credentials as unknown as GoogleCalendarCredentials | undefined;
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    throw new BookingAdapterError("auth_failed", "missing google-calendar credentials");
  }
  const calendarId = (ctx.tenantConfig as any)?.booking?.calendarId ?? "primary";
  const timezone = ctx.tenantConfig.timezone;

  const oauth = new google.auth.OAuth2(creds.client_id, creds.client_secret);
  oauth.setCredentials({ refresh_token: creds.refresh_token });
  const calendar = google.calendar({ version: "v3", auth: oauth });

  return {
    name: "google-calendar" as const,

    async checkAvailability({ serviceId, from, to, limit }) {
      const service = ctx.tenantConfig.services.find((s) => s.id === serviceId);
      if (!service) throw new BookingAdapterError("invalid_service", serviceId);
      const fb = await calendar.freebusy.query({
        requestBody: {
          timeMin: from,
          timeMax: to,
          timeZone: timezone,
          items: [{ id: calendarId }],
        },
      });
      const busy = (fb.data.calendars?.[calendarId]?.busy ?? []).map((b) => ({
        start: b.start!,
        end: b.end!,
      }));
      return computeOpenSlots({
        fromIso: from,
        toIso: to,
        durationMinutes: service.durationMinutes,
        busy,
        stepMinutes: 30,
        limit,
      });
    },

    async createBooking(req: BookingRequest): Promise<BookingResult> {
      const service = ctx.tenantConfig.services.find((s) => s.id === req.serviceId);
      if (!service) throw new BookingAdapterError("invalid_service", req.serviceId);
      const endIso = new Date(
        new Date(req.start).getTime() + service.durationMinutes * 60_000,
      ).toISOString();

      const event: calendar_v3.Schema$Event = {
        summary: `[Service Call] ${req.contactName} — ${truncate(req.problemDescription ?? service.name, 40)}`,
        description: buildDescription(req),
        location: req.address,
        start: { dateTime: req.start, timeZone: timezone },
        end: { dateTime: endIso, timeZone: timezone },
        extendedProperties: {
          private: {
            source: "front-desk",
            contactPhoneE164: req.contactPhoneE164,
          },
        },
      };

      try {
        const res = await calendar.events.insert({ calendarId, requestBody: event });
        logger.info(
          { eventId: res.data.id, calendarId },
          "google-calendar.event.created",
        );
        return {
          externalBookingId: res.data.id!,
          confirmedStart: req.start,
          serviceId: req.serviceId,
          providerId: null,
        };
      } catch (err: any) {
        const code = err?.code;
        if (code === 401 || code === 403) {
          throw new BookingAdapterError("auth_failed", err.message ?? "google auth failed");
        }
        if (code === 429) {
          throw new BookingAdapterError("rate_limited", err.message ?? "rate limited");
        }
        throw new BookingAdapterError("unknown", err?.message ?? String(err));
      }
    },

    async cancelBooking(externalBookingId: string): Promise<void> {
      await calendar.events.delete({ calendarId, eventId: externalBookingId });
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

/** Pure, unit-testable. */
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
  const busyMs = input.busy.map((b) => [
    new Date(b.start).getTime(),
    new Date(b.end).getTime(),
  ] as const);
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
```

### Task 29 — Unit tests for `computeOpenSlots`

**New file:** `apps/api/src/integrations/booking/__tests__/google-calendar.test.ts`

Cases:
- No busy → up to `limit` slots from `from`.
- Busy covering the whole window → zero slots.
- Busy bisecting the window → slots before and after.
- Busy exactly matches a slot boundary → adjacent slots included.
- Duration longer than any gap → zero slots.
- Limit caps output.

### Task 30 — Register in the factory

**Modified:** `apps/api/src/integrations/booking/index.ts`

- Add `"google-calendar"` to the adapter union.
- `BookingAdapter.name` union in `types.ts` gains `"google-calendar"`.
- In `createBookingAdapter`, branch for `"google-calendar"` and call `createGoogleCalendarAdapter(ctx)`. Credentials are loaded from Secrets Manager by the caller (same path the other adapters use) and passed in `ctx.credentials`.

### Task 31 — One-time OAuth connect script

**New file:** `scripts/connect-google-calendar.ts`

```ts
#!/usr/bin/env tsx
/**
 * One-time OAuth handshake for a Google account that owns the calendar the
 * adapter will write to (e.g. fix.garage909@gmail.com). Prints a refresh_token
 * and calendar list; operator writes the secret into Secrets Manager.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
 *     pnpm connect:google-calendar
 */
import http from "node:http";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/oauth2/callback`;

async function main() {
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env.");
    process.exit(1);
  }

  const oauth = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/oauth2/callback")) {
        res.writeHead(404); res.end(); return;
      }
      const code = new URL(req.url, `http://localhost:${PORT}`)
        .searchParams.get("code");
      if (!code) {
        res.writeHead(400); res.end("no code");
        reject(new Error("no code in callback"));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<h1>Done. You can close this tab.</h1>");
      server.close();
      resolve(code);
    });
    server.listen(PORT);
  });

  console.log("\nOpen this URL in your browser, log in as the calendar owner, approve access:");
  console.log(url);

  const code = await codePromise;
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh_token returned. Revoke existing consent at https://myaccount.google.com/permissions and retry.",
    );
    process.exit(1);
  }
  oauth.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: oauth });
  const list = await calendar.calendarList.list();

  console.log("\n--- OAuth success ---");
  console.log(JSON.stringify({
    client_id, client_secret, refresh_token: tokens.refresh_token,
  }, null, 2));
  console.log("\nCalendars on this account:");
  for (const c of list.data.items ?? []) {
    console.log(`  ${c.id}  —  ${c.summary}${c.primary ? "  (primary)" : ""}`);
  }
  console.log(
    "\nStore the JSON above in Secrets Manager at:\n  ${tenant_id}/booking/google-calendar\nThen set tenants.booking_credentials_secret_arn to that ARN.",
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Root `package.json` scripts: add `"connect:google-calendar": "tsx scripts/connect-google-calendar.ts"`.

### Task 32 — Gated smoke test

**New file:** `apps/api/src/integrations/booking/__tests__/google-calendar.smoke.ts`

`describe.skipIf(!process.env.GOOGLE_CALENDAR_SMOKE)(...)` — creates an event 1h in the future, reads it back, deletes it. Skipped in CI; useful locally to verify real credentials.

### Task 33 — Verify Phase 3

```
pnpm --filter @medspa/api build
pnpm --filter @medspa/api test     # includes computeOpenSlots unit tests
```

Then, locally, set up a Google Cloud OAuth client (type: **Desktop app**, redirect URI `http://localhost:53682/oauth2/callback`), run the connect script, confirm the refresh token prints.

**Commit:** `feat: Google Calendar booking adapter + connect script`

---

## Phase 4 — Seed Fix Garage

### Task 34 — `--vertical` in the seed script

**Modified:** `scripts/seed-tenant.ts`

- Accept `--vertical medspa|garage-doors` (default `medspa`).
- Accept `--owner-phone`, `--timezone`, `--adapter`, `--secretArn`.
- Branch on vertical to pick the right `defaultConfig`:

```ts
const vertical = (args.vertical ?? "medspa") as "medspa" | "garage-doors";
const config = vertical === "garage-doors"
  ? garageDoorsDefaultConfig({ name, ownerPhone, timezone })
  : medspaDefaultConfig(name, ownerPhone);
const bookingAdapter = args.adapter
  ?? (vertical === "garage-doors" ? "google-calendar" : "mock");
```

- The INSERT includes `vertical`:

```sql
INSERT INTO tenants (name, twilio_number, vertical, booking_adapter,
                     booking_credentials_secret_arn, config)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (twilio_number) DO UPDATE SET
  name = EXCLUDED.name,
  vertical = EXCLUDED.vertical,
  booking_adapter = EXCLUDED.booking_adapter,
  booking_credentials_secret_arn = EXCLUDED.booking_credentials_secret_arn,
  config = EXCLUDED.config
RETURNING id
```

- Production safety: if `process.env.NODE_ENV === "production"`, require `--confirm <twilioNumber>` matching `--twilio` before running (prevents accidental overwrite of a live tenant's config).

### Task 35 — `garageDoorsDefaultConfig`

In-file helper:

```ts
function garageDoorsDefaultConfig(args: {
  name: string;
  ownerPhone: string;
  timezone: string;
}): TenantConfig {
  return tenantConfigSchema.parse({
    displayName: args.name,
    timezone: args.timezone,
    hours: {
      mon: { open: "08:00", close: "18:00" },
      tue: { open: "08:00", close: "18:00" },
      wed: { open: "08:00", close: "18:00" },
      thu: { open: "08:00", close: "18:00" },
      fri: { open: "08:00", close: "18:00" },
      sat: { open: "09:00", close: "15:00" },
      sun: null,
    },
    services: [{
      id: "service_call",
      name: "Service call",
      description: "Diagnosis + on-site work, typically 60 min.",
      durationMinutes: 60,
      priceCents: 0,
      providerTags: [],
      requiresConsult: false,
    }],
    voice: {
      tone: "friendly",
      signOff: `— ${args.name}`,
      maxSmsChars: 320,
    },
    escalation: {
      ownerPhoneE164: args.ownerPhone,
      escalateOn: ["complaint", "manual"],  // emergency is tracked via notify_owner, not this
      quietHours: null,
      slaMinutesByUrgency: { emergency: 15, complaint: 240, fyi: 1440 },
    },
    booking: {
      minLeadTimeMinutes: 60,
      maxAdvanceDays: 30,
      defaultProviderId: null,
    },
    serviceAreaZips: [],  // operator fills in post-seed
    knowledgeSources: [],
  });
}
```

### Task 36 — Seed commands

```
# Stage 1: create the tenant row
pnpm db:seed -- \
  --vertical garage-doors \
  --name "Fix Garage" \
  --twilio "+1XXXXXXXXXX" \
  --owner-phone "+1YYYYYYYYYY" \
  --timezone America/Phoenix \
  --adapter google-calendar \
  --url "https://fix.garage909.com"

# Stage 2: OAuth handshake
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... pnpm connect:google-calendar

# Stage 3: put the JSON into Secrets Manager, set tenants.booking_credentials_secret_arn
aws secretsmanager create-secret \
  --name "<tenant_id>/booking/google-calendar" \
  --secret-string file://creds.json
psql -c "UPDATE tenants SET booking_credentials_secret_arn='<arn>' WHERE id='<tenant_id>'"
```

### Task 37 — Verify Phase 4

- `psql -c "SELECT id, name, vertical, booking_adapter FROM tenants WHERE name='Fix Garage'"` shows the row with `vertical='garage-doors'`.
- Run a harness-based manual test (admin replay route) that sends an emergency message to the tenant and verifies the full flow ending with a Google Calendar event (use a test calendar, or the friend's calendar if already wired).

**Commit:** `feat: seed-tenant --vertical flag + Fix Garage defaults`

---

## Phase 5 — Dashboard labels

### Task 38 — `useVerticalLabels` helper

**New file:** `apps/dashboard/src/lib/vertical-labels.ts` (or wherever dashboard helpers live).

```ts
import type { VerticalId } from "@medspa/shared";  // or re-export from apps/api
export interface VerticalLabels {
  contactLabel: "Customer" | "Patient";
  categories: readonly string[];
}
export function labelsFor(vertical: VerticalId): VerticalLabels {
  if (vertical === "garage-doors") {
    return {
      contactLabel: "Customer",
      categories: ["faq","booking","emergency","complaint","spam"],
    };
  }
  return {
    contactLabel: "Patient",
    categories: ["faq","booking","clinical","complaint","spam"],
  };
}
```

### Task 39 — Apply labels

Conversations table headers + category filter dropdown read from `labelsFor(tenant.vertical)`. No routing/schema changes.

**Commit:** `feat: vertical-aware dashboard labels`

---

## Phase 6 — Go live

### Task 40 — Provision Twilio number

Buy an SMS+voice number. Point SMS webhook at `/twilio/sms`, voice at `/twilio/voice`. Update `tenants.twilio_number`.

### Task 41 — OAuth handshake

Run `pnpm connect:google-calendar` with `fix.garage909@gmail.com`. Store the secret; set `booking_credentials_secret_arn`.

### Task 42 — End-to-end smoke

From your own phone, text the new number:
1. **FAQ** — "What areas do you service?" → short FAQ reply, no tool except maybe `search_knowledge`.
2. **Booking** — "Spring snapped, can someone come tomorrow?" → `check_availability` reply with 2–3 slots → reply picking one → `create_booking` fires → event created on `fix.garage909@gmail.com` primary calendar.
3. **Emergency** — "Door stuck wide open, car trapped" → `notify_owner(urgency='emergency')` SMS lands on the owner's phone within seconds; conversation status = `escalated`.
4. **Complaint** — "Your tech came Tuesday, still broken" → `notify_owner(urgency='complaint')`; no booking unless opted in.

Confirm each manually. Check the Google Calendar event has location, description with full contact/problem info, private `source=front-desk`.

### Task 43 — Handoff

- Tail production logs for 24h; grep for `error`, `warn`; look for any redaction warnings or `auth_failed` on the Google adapter.
- Walk Joe through the dashboard once.
- Give him a one-pager: how conversations surface, when the owner gets paged, how to edit service-area ZIPs.

---

## Rollback plan

- Schema migrations `001`–`004` are forward-only. Roll back via pre-migration backup snapshot (dev and prod both snapshot before any `pnpm db:migrate` run).
- Medspa behavior is validated by the eval harness at every phase boundary. Any regression blocks the commit.
- If Google Calendar fails in prod, the adapter throws `BookingAdapterError`; the existing tool-error path replies "Our booking system hit a hiccup — the owner will call you back," and the orchestrator's post-check fires `notify_owner(urgency='fyi')` so Joe sees it.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google refresh token revoked / expired (6-month idle) | Adapter surfaces `auth_failed`; orchestrator fallback pages owner. Re-run connect script. |
| Classifier leaks `clinical` into a garage-doors tenant | `classifier.categories` clamps output; unknown output falls back to `faq`. |
| `create_booking` tool called before `check_availability` | Same orchestrator post-check concept: if `create_booking` fires without a prior `check_availability` in the turn, log a WARN. Do not block — booking may still succeed. |
| Cross-vertical tool leakage | Eval scenario 4 (`garage-cross-vertical-isolation`) catches this at CI. |
| Seed script overwrites a production tenant | `NODE_ENV=production` requires `--confirm <twilioNumber>` flag matching `--twilio`. |
| Rename misses a call site | TypeScript `strict` + `noUncheckedIndexedAccess` catch most cases; `pnpm eval` catches behavioral ones. |
| Agent books outside business hours because Google calendar is "free" | `computeOpenSlots` does not know about business hours. Filter applied in a follow-up task if the first real booking misbehaves — MVP accepts it. |

---

## Execution

Phases 1 and 2 are the biggest. Phase 1 has a strict internal order (migrations in numeric order, then code renames). Phase 2 can parallelize prompts + notify_owner tool + eval scenarios once Task 13 (the interface) is in. Phases 3–5 are each independent and can be dispatched in parallel once Phase 2 lands. Phase 6 is operator-driven, not code.

**Dispatch shape for subagent-driven-development:**
- Agent A: Phase 1 (all tasks, sequential due to migration/rename ordering).
- Agent B: Phase 2 Tasks 13–16 (vertical definitions, registry).
- Agent C: Phase 2 Tasks 17 (notify_owner tool + owner-alert module) — depends on B's types.
- Agent D: Phase 2 Tasks 18–21 (prompts/classifier/orchestrator refactor) — depends on B + C.
- Agent E: Phase 2 Tasks 22–24 (eval harness + scenarios) — depends on D.
- Agent F: Phase 3 (Google Calendar adapter) — depends only on Phase 1 + BookingAdapter types; can start after B.
- Agent G: Phase 4 (seed-tenant) — depends on Phase 2's config shape.
- Agent H: Phase 5 (dashboard labels) — depends on Phase 2.
