output "aws_access_key_id" {
  value     = aws_iam_access_key.runtime.id
  sensitive = true
}

output "aws_secret_access_key" {
  value     = aws_iam_access_key.runtime.secret
  sensitive = true
}

output "iam_user_arn" {
  value = aws_iam_user.runtime.arn
}
