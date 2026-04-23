variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Environment name (prod, staging). Feeds into resource naming."
}

variable "project" {
  type    = string
  default = "medspa"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "api_container_image" {
  type        = string
  description = "ECR image URI (e.g. 1234.dkr.ecr.us-east-1.amazonaws.com/medspa-api:latest)"
}

variable "api_container_cpu" {
  type    = number
  default = 512
}

variable "api_container_memory" {
  type    = number
  default = 1024
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "allowed_cidr_blocks" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "CIDRs allowed to hit the ALB. Restrict to Twilio + Vercel egress in prod."
}
