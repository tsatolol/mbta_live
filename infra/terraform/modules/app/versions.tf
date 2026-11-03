# Terraform とプロバイダのバージョン（2026-11 時点の最新安定版に合わせる）
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
    # DB のパスワードを作る（ephemeral なので state に残らない）
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
    # ログベースの指標を作ってから、アラートポリシーで使えるようになるまで待つ（monitoring.tf）
    time = {
      source  = "hashicorp/time"
      version = "~> 0.14"
    }
  }
}
