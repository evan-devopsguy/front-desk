# HIPAA compliance controls map

This document maps each HIPAA Security Rule control to how it's implemented in the MedSpa AI codebase and infrastructure. It's the working reference for our SOC 2 / HIPAA audit prep and the document we point auditors at.

> **Scope**: ePHI handled by this system is limited to (a) patient phone number, (b) inbound SMS content, (c) voicemail **transcripts** received from Twilio (no recordings stored on our infrastructure), (d) outbound assistant responses, (e) booking details (service, time, name). No lab data, insurance info, or clinical records.

## Administrative Safeguards (§164.308)

| Control | Implementation |
|---------|----------------|
| **Security Management Process** (§164.308(a)(1)) | Quarterly risk analysis, tracked in Linear project "SEC". New hires read this doc during onboarding. |
| **Workforce Security** (§164.308(a)(3)) | Least-privilege IAM. Engineers get `ReadOnly` against prod Secrets Manager; production DB access is jump-host-only and audited. |
| **Information Access Management** (§164.308(a)(4)) | Every DB query runs as `medspa_app` with RLS enforced by `tenant_id`. No developer has standing PHI read access. |
| **Security Awareness and Training** (§164.308(a)(5)) | Annual HIPAA training via our L&D provider. Incident reporting runbook: `docs/runbooks/incident-response.md` (populated during GA). |
| **Security Incident Procedures** (§164.308(a)(6)) | On-call rotation. PagerDuty integration to #medspa-ops. Incidents classified within 1 hour; Notice-of-Breach workflow below. |
| **Contingency Plan** (§164.308(a)(7)) | RDS Multi-AZ + 30-day PITR backups. Infrastructure is 100% Terraform — full rebuild from code. Runbooks in `docs/runbooks/`. |
| **Evaluation** (§164.308(a)(8)) | Annual third-party pen test. Quarterly internal review. Control evidence exported from AWS Config. |
| **BAA** (§164.308(b)) | `docs/BAA-template.md` — we sign with every covered-entity client. We sign downstream BAAs with AWS (signed), Anthropic via Bedrock (covered by AWS BAA), Twilio (signed), Supabase (dev only, no PHI). |

## Physical Safeguards (§164.310)

| Control | Implementation |
|---------|----------------|
| **Facility Access** | All compute runs in AWS data centers under AWS's physical controls (SOC 2 / HIPAA). No on-prem ePHI. |
| **Workstation Use** | Managed laptops (Kolide + Jamf), FileVault, auto-lock. No PHI downloaded to workstations. |
| **Device and Media Controls** | Workstation wipe on offboarding; RDS snapshots encrypted with customer-managed KMS key and retained 30 days. |

## Technical Safeguards (§164.312)

| Control | Implementation |
|---------|----------------|
| **Access Control (§164.312(a))** | DB-level RLS using `app.tenant_id` GUC. API connects as non-superuser `medspa_app`. Secrets via AWS Secrets Manager + IAM. |
| **Unique User Identification** | MVP has no operator UI; PHI access is via direct DB queries by an authenticated AWS principal. Every DB write tags `app.actor` — we can attribute writes per-user when an operator UI lands. |
| **Emergency Access** | Break-glass IAM role with 15-minute session, alerts on use. |
| **Encryption — at rest** | RDS encrypted with customer-managed KMS key (`aws_kms_key.db`), key rotation enabled. S3 (none in MVP). Secrets Manager encrypted with same key. |
| **Encryption — in transit** | `rds.force_ssl=1` parameter. TLS 1.2+ at ALB. API↔Bedrock uses VPC Interface Endpoint (never leaves AWS backbone). Twilio webhook signature validated (`X-Twilio-Signature`). |
| **Audit Controls (§164.312(b))** | `audit_log` table + triggers on every PHI-bearing table. CloudWatch Logs retained 365 days, encrypted. |
| **Integrity (§164.312(c))** | DB writes are transactional; RLS blocks cross-tenant mutations. Hash of patient phone persists; raw phone is never stored. |
| **Authentication (§164.312(d))** | API has no public read endpoints; Twilio webhooks are signature-validated. PHI reads happen out-of-band via authenticated DB sessions. |
| **Transmission Security (§164.312(e))** | All external traffic (Twilio, Bedrock) TLS 1.2+. Owner-notify SMS is tenant-to-tenant only (no cross-tenant leak). |

## Organizational Safeguards (§164.314)

- We sign a BAA with every client before a single inbound SMS is processed.
- Downstream BAAs: **AWS** (covers Bedrock), **Twilio**, **any future EHR/booking platform**.
- Subcontractor diligence: SOC 2 Type II required before any vendor touches ePHI.

## Breach Notification (§164.400 et seq.)

1. Detection: CloudWatch alarms on unusual DB access patterns + audit-log anomaly detection.
2. Classification: within 1 hour of detection.
3. Containment: runbook `docs/runbooks/breach-containment.md` (rotate credentials, revoke sessions, disable tenant if needed).
4. Notification: impacted covered-entity clients within 24 hours; downstream patient notification via the client per §164.404.

## Voice channel

The voice channel is **asynchronous voicemail-to-SMS**: Twilio answers the call, plays a greeting, records a voicemail (≤90s), and transcribes it. We receive the transcript via `POST /twilio/voice/transcription` and route it through the same classifier + orchestrator as inbound SMS; the agent replies by SMS to the caller's number.

- **Recordings stay at Twilio.** We never download or store the audio. Twilio is under BAA (see [BAA-template.md](./BAA-template.md)). Retention follows Twilio's configured policy for the tenant's sub-account.
- **Transcripts are PHI** and land in the `messages` table with `conversation.channel = 'voice'`. They inherit the full set of controls: RLS by `tenant_id`, DB-level audit trigger, encryption at rest, PHI redaction in all app logs via `lib/pii.ts`.
- **No live voice AI.** There is no real-time STT/TTS path, no MediaStreams WebSocket. A later phase may add real-time voice; at that point this section needs to be re-scoped (STT/TTS vendor BAAs, latency SLOs, barge-in handling).
- **Transcription failures fall back** to an SMS inviting the caller to text us. Audited as `voicemail_transcription_unusable`.

## What's deliberately NOT in scope

- No real-time voice AI (live STT/TTS). Only async voicemail-to-SMS as described above.
- No insurance or payment data. If/when billing lands, PCI scope is separated from PHI path.
- No cross-border data flow: everything is `us-east-1`.

## Evidence artifacts (for auditors)

- `infra/terraform/` — the whole infra, reviewable as code.
- `apps/api/src/db/schema.sql` — RLS policies + audit triggers.
- `apps/api/src/lib/pii.ts`, `apps/api/src/lib/audit.ts` — application-layer PHI + audit enforcement.
- CloudTrail (all AWS API calls), CloudWatch Logs (app + DB), `audit_log` table (application events).
- `packages/eval/src/scenarios.ts` — including the cross-tenant leak test that ships with every build.
