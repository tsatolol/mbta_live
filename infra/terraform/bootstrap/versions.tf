# Terraform とプロバイダのバージョン（2026-11 時点の最新安定版に合わせる）
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
    # GitHub の Environment・variables・secrets・ルールセット（github.tf）
    # T010 の init で入った 6.13.0（2026-11 時点の最新安定版）に合わせる
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}
