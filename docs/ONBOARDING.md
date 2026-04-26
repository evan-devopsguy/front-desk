# Onboarding a new spa — runbook

Target: new spa live and answering SMS in **under 2 hours**.

## Pre-onboarding checklist (before the kickoff call)

- [ ] Signed BAA on file (`docs/BAA-template.md`).
- [ ] Signed Services Agreement with MRR + churn terms.
- [ ] Owner's preferred escalation phone number (E.164 format, e.g. `+15555550100`).
- [ ] Spa's public website URL for RAG ingest.
- [ ] Confirmed booking system: mock (MVP), Boulevard, or Vagaro. If real, get API credentials stored in Secrets Manager under `${tenant}/booking/<adapter>`.

## Step 1 — Provision the Twilio number (15 min)

1. Console → Phone Numbers → Buy. Choose a number in the tenant's area code.
2. Configure **Messaging**: webhook `POST https://<api-alb>/twilio/sms` (HTTP POST, `x-www-form-urlencoded`).
3. Configure **Voice**: webhook `POST https://<api-alb>/twilio/voice` (HTTP POST). The tenant's config decides what happens next (see [Voice modes](#voice-modes) below). Twilio posts the voicemail transcript to `/twilio/voice/transcription` automatically; if the tenant uses ring-owner-first mode, Twilio also posts the dial result to `/twilio/voice/no-answer`.
4. Save the Twilio number in E.164 format.

### Voice modes

There are two shapes a tenant's voice flow can take:

| Mode | Config | Behavior |
|---|---|---|
| **Voicemail-only** (default) | `voice.forwardBeforeVoicemail: null` | Caller hears greeting, leaves voicemail, gets SMS reply from the agent. Best for tenants who don't want their personal phone involved. |
| **Ring-owner-first** (garage-doors default) | `voice.forwardBeforeVoicemail: { enabled: true, timeoutSeconds: 18 }` | Caller's call rings the owner's cell (from `escalation.ownerPhoneE164`) for N seconds. If the owner picks up, it's a normal phone call. If not, the flow falls back to voicemail + SMS reply. |

In ring-owner-first mode, caller ID on the forwarded leg is always the tenant's own Twilio number — **not** the original caller's number. This is deliberate: the owner saves their Twilio number as a contact once, and every forwarded call rings through regardless of any "silence unknown callers" filtering on their personal phone. **Tell the owner during onboarding: "save your Twilio number in your phone contacts."**

**Known limitation:** if the owner's carrier auto-sends to voicemail before our `timeoutSeconds` expires (some carriers do this at 15–20s), Twilio sees the leg as "completed" and the call ends in the owner's personal voicemail, not ours. The default of 18s is tuned to be shorter than most US carrier VM timers but it's not bulletproof. If a tenant reports missed calls landing in their personal VM, either lower `timeoutSeconds` or add call-screening (press-1-to-accept) as a follow-up.

## Step 2 — Create the tenant (5 min)

```bash
pnpm db:seed -- \
  --name "Aurora Med Spa" \
  --twilio "+15555550001" \
  --owner "+15555550100" \
  --url   "https://auroramedspa.example.com"
```

The script upserts the tenant, applies a sensible default config, and ingests the site into `knowledge_chunks` with per-tenant embeddings.

## Step 3 — Fill in the config (30 min)

Defaults are usable for a demo, but each spa should confirm:

- **Services**: name, duration, price, whether a consult is required. Ids should be stable (`hydrafacial`, not `facial-v2`).
- **Hours**: per day, `null` for closed days.
- **Voice tone**: `warm | professional | luxury | friendly`.
- **Sign-off**: short, e.g., `— Aurora`. Optional.
- **Voicemail greeting**: optional override for the spoken greeting callers hear (`config.voice.voicemailGreeting`). Default is generated from the spa name.
- **Escalation rules**: which intents page the owner, quiet hours.
- **Minimum lead time**: usually 120 minutes so the agent never proposes "right now".

Apply config changes by re-running `pnpm db:seed` (it upserts on the
twilio_number key) or with a direct `UPDATE tenants SET config = ...`.

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
5. Inspect the conversation directly in Postgres — every turn and the classifier decision are persisted to `messages` and `audit_log`:
   ```sql
   SELECT role, content, created_at FROM messages
     WHERE tenant_id = '<id>' ORDER BY created_at DESC LIMIT 20;
   SELECT action, metadata, at FROM audit_log
     WHERE tenant_id = '<id>' ORDER BY at DESC LIMIT 20;
   ```
6. *Call* the tenant's Twilio number and leave a 10-second voicemail asking about hours — expect the greeting to play (or, in ring-owner-first mode, the owner's cell to ring for ~18s before falling through to voicemail), the call to end, and within ~30s an SMS reply arrives on your phone based on the transcript. The conversation row will show `channel: voice`.
7. If ring-owner-first mode is enabled, *also* call and have the owner pick up — expect a normal phone call with no bot involvement, and no SMS sent to the caller. The `voice_forwarded` audit event should appear without a subsequent `voicemail_started`.

## Step 6 — Hand-off (30 min)

- Confirm the escalation SMS reaches the owner — show them what one looks like, and explain that they reply to the customer directly from their cell.
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
| Ring-owner-first: call lands in owner's personal VM instead of ours | Carrier VM picked up before our `timeoutSeconds` expired | Lower `voice.forwardBeforeVoicemail.timeoutSeconds` (try 15), or instruct owner to extend their carrier VM delay. |
| Ring-owner-first: forwarded call shows caller's number instead of Twilio number | TwiML builder didn't set `callerId` | Check `buildForwardTwiml` — `callerId` must equal `tenant.twilioNumber`. |
