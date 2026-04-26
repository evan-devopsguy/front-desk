# Agent development guidelines (for AI coding assistants working in this repo)

## Non-negotiables
1. **PII never leaves the DB in plaintext.** No PII in logs, no PII in errors, no PII in cache keys. Route everything through `lib/pii.ts`.
2. **Every table has `tenant_id`.** Every new query runs inside `withTenant()` so RLS applies. If you're writing `unscoped()`, explain why in the PR description.
3. **Every PHI write is audited.** DB triggers cover `conversations`, `messages`, `bookings`, `knowledge_chunks`. If you add a PHI table, add the trigger in the same PR.
4. **Clinical → escalate.** The agent does not answer medical questions. Never weaken the classifier's clinical path.
5. **No raw OpenAI, no Zapier, no n8n** in the PHI path. All LLM traffic goes through AWS Bedrock.

## Working principles
Distilled from the `andrej-karpathy-skills:karpathy-guidelines` skill — apply
where they don't conflict with the non-negotiables above.

1. **Surface assumptions before writing code.** If you're guessing at a tenant-scoping rule, an escalation trigger, or an audit requirement, say so and ask. The wrong default in this codebase silently corrupts PHI or leaks across tenants — there is no safe "best guess" for the invariants in §Non-negotiables.
2. **Surgical changes.** Every diff line should trace to the request. Don't reformat, rename, or "improve" adjacent code. If you spot real dead code or a separate issue, mention it in the PR description — don't bundle it into the same change.
3. **Simplicity first.** No speculative abstractions, no flag-ifying things that have one caller, no error handling for cases that can't happen. Three similar lines beat a premature helper. If you wrote 200 lines and 50 would do, rewrite.
4. **Goal-driven, with a runnable verification.** Translate the ask into a check you can actually execute — a vitest assertion, an eval scenario, a documented smoke test. "It compiles" and "tests still pass" are not verifications of new behavior; they are the floor.
5. **State the plan for anything beyond a one-liner.** A short numbered plan with the verification next to each step, before code, beats a sprawling diff with "made changes" as the description.

## Code conventions
- TypeScript strict; `noUncheckedIndexedAccess` is on. Don't add `any`.
- Files are focused — one responsibility per module. Split before a file crosses ~300 lines.
- Prefer pure functions + explicit dependencies passed in. No hidden singletons except the pg pool, bedrock client, and logger.
- Zod at boundaries (HTTP, env, tenant config). Never trust raw `req.body`.
- Tests live next to the code in `__tests__/` when added; unit tests are vitest.

## Adding a new booking adapter
1. Implement `BookingAdapter` in `apps/api/src/integrations/booking/<name>.ts`.
2. Register in `createBookingAdapter` in the same directory's `index.ts`.
3. Add a `CHECK` value to `tenants.booking_adapter` in `schema.sql`.
4. Credentials live in Secrets Manager under `${tenant}/booking/<name>`; fetch in the ctx.
5. Add an eval scenario that exercises the adapter's happy path.

## Adding a new tool to the agent
1. Append its definition to `TOOL_DEFINITIONS` in `agent/tools.ts`.
2. Add a branch in `runTool()`; return `{ content, isError, outcome? }`.
3. If it mutates PHI, call `auditWithin(client, { ... })` inside the handler.
4. Update the system prompt in `agent/prompts.ts` so the model knows about it.
5. Add an eval scenario.

## Running the eval harness
```
docker-compose up -d         # needs Postgres
pnpm eval                    # exits 1 on any regression
```
The harness reseeds tenants each run and resets the mock booking adapter between scenarios.

## Style nits the reviewer will flag
- No `console.log`. Use `logger.info/warn/error`.
- No `process.env.FOO`. Go through `getConfig()`.
- No inline SQL outside `db/repository.ts` (except migrations and eval seed).
- Tool outputs returned to the LLM are short and declarative — they're read by the model, not a human.
