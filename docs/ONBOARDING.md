# Onboarding a new spa — runbook

Target: new spa live and answering SMS in **under 2 hours**.

## Pre-onboarding checklist (before the kickoff call)

- [ ] Signed BAA on file (`docs/BAA-template.md`).
- [ ] Signed Services Agreement with MRR + churn terms.
- [ ] Owner's preferred escalation phone number (E.164 format, e.g. `+15555550100`).
- [ ] Spa's public website URL for RAG ingest.
- [ ] Confirmed booking system: mock (MVP), Boulevard, or Vagaro. If real, get API credentials stored in Secrets Manager under `${tenant}/booking/<adapter>`.

## Step 1 — Provision the Twilio number (15 min)

1. Console → Phone Numbers → Buy. Choose a number in the spa's area code.
2. Configure **Messaging**: webhook `POST https://<api-alb>/twilio/sms` (HTTP POST, `x-www-form-urlencoded`).
3. Configure **Voice**: webhook `POST https://<api-alb>/twilio/voice` (HTTP POST). Callers hear a greeting, leave a voicemail, Twilio transcribes it, and the agent replies by SMS to the caller's number. No separate voice setup is required — Twilio posts the transcript to `/twilio/voice/transcription` automatically.
4. Save the Twilio number in E.164 format.

## Step 2 — Create the tenant (5 min)

### Option A — CLI (preferred)

```bash
pnpm db:seed -- \
  --name "Aurora Med Spa" \
  --twilio "+15555550001" \
  --owner "+15555550100" \
  --url   "https://auroramedspa.example.com"
```

The script upserts the tenant, applies a sensible default config, and ingests the site into `knowledge_chunks` with per-tenant embeddings.

### Option B — POST /admin/tenants

```bash
curl -X POST https://<api-alb>/admin/tenants \
  -H "authorization: Bearer $API_PROXY_TOKEN" \
  -H "content-type: application/json" \
  --data @tenant-config.json
```

## Step 3 — Fill in the config (30 min)

Defaults are usable for a demo, but each spa should confirm:

- **Services**: name, duration, price, whether a consult is required. Ids should be stable (`hydrafacial`, not `facial-v2`).
- **Hours**: per day, `null` for closed days.
- **Voice tone**: `warm | professional | luxury | friendly`.
- **Sign-off**: short, e.g., `— Aurora`. Optional.
- **Voicemail greeting**: optional override for the spoken greeting callers hear (`config.voice.voicemailGreeting`). Default is generated from the spa name.
- **Escalation rules**: which intents page the owner, quiet hours.
- **Minimum lead time**: usually 120 minutes so the agent never proposes "right now".

Apply config changes via:
```
PATCH /admin/tenants/{id}   (roadmap — MVP uses direct DB update or re-seed)
```

## Step 4 — Ingest the knowledge base (10 min)

If `--url` was passed to `seed-tenant`, you're done. To re-ingest (e.g., after the spa updates pricing):

```bash
pnpm tsx scripts/seed-tenant.ts \
  --name "Aurora Med Spa" \
  --twilio "+15555550001" \
  --url   "https://auroramedspa.example.com/pricing"
```

Re-ingest deletes old chunks sourced from the same URL and re-embeds.

## Step 5 — Smoke test (20 min)

From your own phone, text the spa's Twilio number:
1. `Hi, what are your hours?` → expect factual answer from KB.
2. `How much is a hydrafacial?` → expect price from config.
3. `I'd like to book something for Friday.` → expect availability probing + confirmation flow.
4. `Is Botox safe during pregnancy?` → expect clinical escalation (not a medical answer). Owner's phone should receive an SMS.
5. Check the dashboard (`/dashboard/conversations?tenantId=...`) — you should see every turn and the classifier decision.
6. *Call* the spa's Twilio number, leave a 10-second voicemail asking about hours — expect the greeting to play, the call to hang up, and within ~30s an SMS reply arrives on your phone based on the transcript. The conversation appears in the dashboard with `channel: voice`.

## Step 6 — Hand-off (30 min)

- Walk the owner through the dashboard.
- Show them how the escalation SMS looks and how to reply to the patient from the dashboard (roadmap) or directly.
- Confirm the escalation number is monitored 24/7 or that quiet hours are configured.

## Post-onboarding

- Review the first 48 hours of conversations. Tag any odd behavior in Linear and add to the eval harness if reproducible.
- Add any net-new service to the tenant's config if the bot was asked about it and didn't know.
- Schedule a 2-week follow-up to review volume, escalation rate, and booking conversion.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Inbound SMS not received | Twilio webhook URL wrong | Verify `/twilio/sms` full URL + POST. |
| Twilio signature validation fails | Trailing slash / proxy rewriting URL | Set `PUBLIC_BASE_URL` to the exact ALB hostname used by Twilio. |
| Bot answers clinical questions | Classifier prompt edited, or `maxIterations` too high | Check `agent/prompts.ts`; verify `clinical` intent fires on the test. |
| No availability ever | Hours all `null` or service duration > day length | Verify tenant config hours + service duration. |
| Cross-tenant data visible | RLS disabled or API running as superuser | API must connect as `medspa_app`. Check `pg_roles`. |
| Call rings but no greeting / hangs up | Voice webhook not configured in Twilio | Set Voice webhook to `POST /twilio/voice`. Verify `PUBLIC_BASE_URL` matches the URL Twilio calls. |
| Voicemail left but no SMS back | Transcription failed or callback blocked | Check `audit_log` for `voicemail_transcription_unusable`. Caller should receive fallback SMS if transcription was empty. |
