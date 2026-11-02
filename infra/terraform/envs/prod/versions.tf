# Terraform と Google プロバイダのバージョン（2026-11 時点の最新安定版に合わせる）
# backend（GCS）と module "app" の呼び出しは T017 で追加する
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
  }
}
