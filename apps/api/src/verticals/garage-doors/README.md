# garage-doors vertical

This vertical models a garage-door repair / service business — the after-hours SMS receptionist for a local garage-door company handling service calls, emergency lockouts (car trapped, door stuck), warranty and brand questions, and complaint triage. Compliance is the platform's **standard** tier: PII redaction, per-tenant RLS, and audit triggers still apply, but there's no HIPAA-grade retention requirement and no BAA is needed with the model provider.

## What's vertical-specific vs. platform

- **Vertical (lives here):**
  - Classifier categories: `faq | booking | emergency | complaint | spam`.
  - Tool set: `search_knowledge`, `check_availability`, `create_booking`, `notify_owner`, `end_conversation`. Note `escalate_to_human` is medspa-only — garage-doors escalates via `notify_owner` (SMS/page to the owner).
  - Escalation rule: `emergency` intent MUST trigger `notify_owner` with `urgency="emergency"` before `end_conversation` — enforced by the orchestrator post-check wired in Phase 2d.
  - SLA map: `emergency` 15 min, `complaint` 240 min, `fyi` 1440 min. Consumed by the `notify_owner` body so the owner's page reflects urgency.
  - Compliance tier: `standard`, `baaRequired: false`.
- **Platform (shared across verticals):**
  - Tool implementations (`agent/tools.ts`), DB schema + RLS, audit triggers on PHI tables, PII redaction pipeline (`lib/pii.ts`), the `BookingAdapter` interface, and the Bedrock client path. None of these are duplicated per-vertical.

## Staged landing

The system prompt uses `{{token}}` placeholders (`{{displayName}}`, `{{voiceTone}}`, `{{nowIso}}`, `{{timezone}}`, `{{maxSmsChars}}`, `{{signOff}}`) that will be interpolated by the vertical-generic `buildSystemPrompt` introduced in Phase 2d. **Nothing in Phase 2b reads these files at runtime** — the registry (`../index.ts`) simply exposes them. The orchestrator still routes everything through the legacy medspa prompt builder in `agent/prompts.ts` until Phase 2d rewires it to consume `VERTICALS[tenant.vertical]`.
