# Bedrock IAM — mgmt fallback module

Mirror of `infra/terraform-bedrock/` but provisioned in the **mgmt** AWS
account (271251179226) instead of FrontDesk (447640317942). Exists because
brand-new sub-accounts hit an opaque `Your account is not authorized` gate
on `bedrock:PutUseCaseForModelAccess` that requires a manual support case
to clear; mgmt is grandfathered in. **Destroy this once FrontDesk Bedrock
access is granted** — that's the long-term home.

State and apply pattern are identical to `../terraform-bedrock/`. Provider
profile is `mgmt`. Outputs the same `aws_access_key_id` /
`aws_secret_access_key` that go into the Mac Mini's `.env.production`.

## What this creates (in addition to Bedrock invoke)

The policy also grants `secretsmanager:GetSecretValue` on
`arn:aws:secretsmanager:*:*:secret:front-desk/*/booking/*` — used by the
runtime to load booking adapter credentials (e.g. google-calendar OAuth
bundle) per-tenant.

## Apply

```bash
cd infra/terraform-bedrock-mgmt
terraform init
terraform apply
```
