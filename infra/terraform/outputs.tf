output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "rds_endpoint" {
  value     = aws_db_instance.this.endpoint
  sensitive = true
}

output "db_secret_arn" {
  value = aws_secretsmanager_secret.db.arn
}

output "api_log_group" {
  value = aws_cloudwatch_log_group.api.name
}
