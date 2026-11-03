# Terraform と Google プロバイダのバージョン（2026-11 時点の最新安定版に合わせる）
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
  }
}
