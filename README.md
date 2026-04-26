# MedSpa AI Receptionist

After-hours SMS + voicemail receptionist for medical spas. HIPAA-compliant architecture, multi-tenant from day one. Voice calls are answered by voicemail; Twilio transcribes them and the agent replies by SMS — so calls and texts share one orchestrator.

## Quickstart

```bash
# 1. Local Postgres with pgvector + schema applied
docker-compose up -d
cp .env.example .env

# 2. Install + build shared package
pnpm install
pnpm -r build

# 3. Run the API
pnpm dev
# → listens on http://localhost:3001

# 4. Seed a demo tenant
pnpm db:seed -- --name "Aurora Med Spa" --twilio "+15555550001"

# 5. Run a demo conversation (no real Twilio required)
pnpm demo

# 6. Run the eval harness
pnpm eval
```

## What's in here

| Path | What |
|------|------|
| `apps/api` | Fastify orchestrator: Twilio webhook, agent. |
| `packages/shared` | Zod schemas + shared types used by API and eval. |
| `packages/eval` | Scripted-conversation eval harness (runs on every PR). |
| `infra/terraform` | AWS: VPC, Fargate, RDS (encrypted, Multi-AZ), Secrets Manager, KMS. |
| `scripts/seed-tenant.ts` | Onboard a new spa from a URL. |
| `scripts/demo-conversation.ts` | 90-second scripted demo for sales calls. |
| `docs/` | BAA template, HIPAA controls map, per-client onboarding runbook. |

## Architecture (MVP)

```
Twilio SMS ───────────▶ /twilio/sms ─────────────┐
Twilio Voice call ───▶ /twilio/voice (TwiML) ─▶  │
  voicemail → Twilio transcribes → POST /twilio/voice/transcription
                                                 ├─▶ orchestrator (Claude Sonnet 4.5, Bedrock)
                                                          │
                                                          ├─▶ tools: search_knowledge, check_availability,
                                                          │   create_booking, escalate_to_human, end_conversation
                                                          │
                              Postgres (RDS, KMS, RLS per tenant) ◀─ pgvector RAG
```

- **Classifier**: Claude Haiku 4.5 routes each inbound to `faq|booking|clinical|complaint|spam`.
- **Clinical always escalates.** The agent cannot answer medical questions.
- **Every PHI write** is auto-audited by a DB trigger (`audit_log`).
- **Row-Level Security**: the API connects as a non-superuser and sets `app.tenant_id` per request. Cross-tenant reads are physically impossible.

## Principles

1. **No PHI in logs.** `lib/pii.ts` redacts phone, email, DOB, SSN, and every known sensitive key before pino writes anything.
2. **Secrets in AWS Secrets Manager** in prod. `.env.example` is dev-only.
3. **Multi-tenant from day one.** Every table has `tenant_id`; every request is transactional with RLS scoped.
4. **Eval before deploy.** CI runs the eval harness on every PR; cross-tenant leak test is non-negotiable.
5. **No raw OpenAI, Zapier, or n8n** anywhere in the PHI path.

## Scripts

| Command | What |
|---------|------|
| `pnpm dev` | Start the API in watch mode. |
| `pnpm typecheck` | All packages. |
| `pnpm test` | Unit tests. |
| `pnpm eval` | Scripted-conversation regression suite. |
| `pnpm db:migrate` | Apply `schema.sql` to `DATABASE_URL`. |
| `pnpm db:seed -- --name ... --twilio ... --url ...` | Onboard a tenant. |
| `pnpm demo` | Run the sales-call demo. |

## Deploy

See `infra/terraform/` for AWS. Copy `terraform.tfvars.example` to `terraform.tfvars`, fill in your ECR image URI, then `terraform apply`. The single-tenant Mac Mini deployment for Cooper Family Garage Doors is documented separately in [`docs/MAC_MINI_DEPLOY.md`](./docs/MAC_MINI_DEPLOY.md).

## Compliance

See [`docs/COMPLIANCE.md`](./docs/COMPLIANCE.md) for the HIPAA controls map and [`docs/BAA-template.md`](./docs/BAA-template.md) for the BAA we sign with spas.
