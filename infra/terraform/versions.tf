terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state — fill in during first apply.
  # backend "s3" {
  #   bucket         = "medspa-tfstate"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "medspa-tf-locks"
  # }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "medspa-ai"
      Environment = var.environment
      ManagedBy   = "terraform"
      Compliance  = "hipaa"
    }
  }
}
