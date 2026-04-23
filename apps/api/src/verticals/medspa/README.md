# medspa vertical

Models after-hours SMS reception for medical spas — aesthetic and cosmetic
service providers (injectables, laser, skin treatments, etc.). This vertical
runs at the HIPAA compliance tier: tenants in this vertical require a signed
BAA, PII/PHI never leaves the database in plaintext, and every PHI write is
audited. The agent never answers medical questions; clinical intents always
escalate to a human.

What's vertical-specific (lives in this module): the system prompt template,
the classifier categories (`faq`, `booking`, `clinical`, `complaint`, `spam`),
the allowed tool list, the escalation rule (any `clinical` intent must call
`escalate_to_human` before `end_conversation`), the list of booking adapters
this vertical supports (`mock`, `boulevard`, `vagaro`), and the compliance
tier (`hipaa`, BAA required). Everything else — tool implementations, the
orchestrator loop, DB schema, RLS policies, audit triggers, adapter
interfaces, eval harness — is shared platform code and lives outside
`verticals/`.

Staged-landing note: as of Phase 2a, the `system` prompt string in
`prompts.ts` is intentionally empty. The legacy `buildSystemPrompt` function
in `agent/prompts.ts` still owns the medspa system prompt and performs the
tenant-config interpolation. Phase 2d moves the full template here and
rewires `agent/prompts.ts` to interpolate whichever vertical's string is
passed in, at which point `Vertical.prompts.system` becomes the source of
truth.
