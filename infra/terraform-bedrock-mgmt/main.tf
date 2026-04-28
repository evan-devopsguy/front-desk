resource "aws_iam_user" "runtime" {
  name = "front-desk-runtime"
  path = "/runtime/"
}

data "aws_iam_policy_document" "bedrock_invoke" {
  statement {
    sid    = "InvokeAnthropicAndTitanModels"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-sonnet-4-6*",
      "arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-*",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*",
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*",
      "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0",
    ]
  }

  statement {
    sid     = "ReadBookingAdapterSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "arn:aws:secretsmanager:*:*:secret:front-desk/*/booking/*",
    ]
  }
}

resource "aws_iam_policy" "bedrock_invoke" {
  name        = "front-desk-bedrock-invoke"
  description = "InvokeModel on the 3 Bedrock models the Front Desk agent uses"
  policy      = data.aws_iam_policy_document.bedrock_invoke.json
}

resource "aws_iam_user_policy_attachment" "runtime_bedrock" {
  user       = aws_iam_user.runtime.name
  policy_arn = aws_iam_policy.bedrock_invoke.arn
}

resource "aws_iam_access_key" "runtime" {
  user = aws_iam_user.runtime.name
}
