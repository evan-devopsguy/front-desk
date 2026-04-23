resource "aws_db_subnet_group" "this" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name = "${local.name}-db-subnets" }
}

resource "aws_kms_key" "db" {
  description             = "${local.name} RDS + logs encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "${local.name}-kms-db" }
}

resource "aws_kms_alias" "db" {
  name          = "alias/${local.name}-db"
  target_key_id = aws_kms_key.db.key_id
}

resource "random_password" "db" {
  length  = 32
  special = true
  # keep DB URI-safe
  override_special = "!_-"
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db"
  vpc_id = aws_vpc.this.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "this" {
  identifier                 = "${local.name}-db"
  engine                     = "postgres"
  engine_version             = "16.4"
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_allocated_storage_gb
  max_allocated_storage      = var.db_allocated_storage_gb * 4
  storage_encrypted          = true
  kms_key_id                 = aws_kms_key.db.arn
  db_name                    = "medspa"
  username                   = "medspa_admin"
  password                   = random_password.db.result
  db_subnet_group_name       = aws_db_subnet_group.this.name
  vpc_security_group_ids     = [aws_security_group.db.id]
  parameter_group_name       = aws_db_parameter_group.pg16.name
  backup_retention_period    = 30
  backup_window              = "03:00-04:00"
  multi_az                   = true
  deletion_protection        = true
  publicly_accessible        = false
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-db-final"
  performance_insights_enabled = true
  performance_insights_kms_key_id = aws_kms_key.db.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
}

resource "aws_secretsmanager_secret" "db" {
  name       = "${local.name}/db/connection"
  kms_key_id = aws_kms_key.db.id
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    DATABASE_URL = "postgres://medspa_admin:${random_password.db.result}@${aws_db_instance.this.endpoint}/medspa?sslmode=require"
  })
}
