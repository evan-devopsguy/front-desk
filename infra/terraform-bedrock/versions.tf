terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region  = "us-east-1"
  profile = "frontdesk"

  default_tags {
    tags = {
      Project   = "front-desk"
      Tenant    = "cooper-family"
      ManagedBy = "terraform"
    }
  }
}
