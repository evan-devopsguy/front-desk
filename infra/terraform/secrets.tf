# Placeholder secrets the API expects. Populate via AWS CLI or Terraform
# with `terraform import`; never commit values.
resource "aws_secretsmanager_secret" "twilio" {
  name       = "${local.name}/twilio"
  kms_key_id = aws_kms_key.db.id
}

resource "aws_secretsmanager_secret" "bedrock" {
  name       = "${local.name}/bedrock"
  kms_key_id = aws_kms_key.db.id
}

resource "aws_secretsmanager_secret" "proxy_token" {
  name       = "${local.name}/dashboard/proxy-token"
  kms_key_id = aws_kms_key.db.id
}
