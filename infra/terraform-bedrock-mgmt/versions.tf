terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

# Temporary fallback module: provisions the Bedrock-invoke IAM user in the
# mgmt account because the FrontDesk sub-account (447640317942) is gated by
# AWS Support for first-time Anthropic model access. The parallel module at
# infra/terraform-bedrock/ stays in place for the eventual cutover — destroy
# this one once FrontDesk Bedrock access is granted.
provider "aws" {
  region  = "us-east-1"
  profile = "mgmt"

  default_tags {
    tags = {
      Project   = "front-desk"
      Tenant    = "cooper-family"
      ManagedBy = "terraform"
      Note      = "temporary-mgmt-bedrock-fallback"
    }
  }
}
