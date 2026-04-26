# Bedrock IAM — Terraform module

Provisions a runtime IAM user for the Front Desk Mac Mini deployment with
permission to invoke the three Bedrock models the agent uses. **Deliberately
separate** from `infra/terraform/` (the unbuilt cloud deploy) so its state
can't be corrupted by an accidental `apply` of the larger module.

State lives at `terraform.tfstate` in this directory (local). For a
single-tenant Mac Mini deployment that's fine — there's exactly one operator,
no concurrent applies. If a second operator ever joins, move state to S3.

## Apply

```bash
cd infra/terraform-bedrock
terraform init
terraform apply
# Outputs the access key id + secret. Copy them into .env.production on
# the Mac Mini as AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.
```

The `aws` provider is pinned to the `frontdesk` profile — make sure
`~/.aws/config` has that profile (assume-role into the FrontDesk sub-account).

## What this creates

| Resource | Purpose |
|---|---|
| `aws_iam_user.runtime` | The user the API container authenticates as |
| `aws_iam_policy.bedrock_invoke` | Allows `InvokeModel` + streaming on **only** the 3 specific Anthropic / Titan models the agent uses |
| `aws_iam_user_policy_attachment.runtime_bedrock` | Wires the policy to the user |
| `aws_iam_access_key.runtime` | Long-lived access key for the user |

The policy covers both the cross-region inference profiles
(`us.anthropic.claude-*`) and the underlying foundation-model ARNs they
fan out to (Bedrock cross-region routing requires both).

## Rotating the access key

```bash
terraform taint aws_iam_access_key.runtime
terraform apply
# Update .env.production with new outputs, then `docker compose ... up -d --force-recreate api`
```
