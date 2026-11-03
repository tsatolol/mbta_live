# Terraform とプロバイダのバージョン（2026-11 時点の最新安定版に合わせる）
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
    # GitHub の Environment・variables・secrets・ルールセット（github.tf）
    # 開発環境から Terraform のレジストリに接続できず、最新版を確かめられなかった。T010 の init で確かめる（research.md）
    github = {
      source  = "integrations/github"
      version = "~> 6.6"
    }
  }
}
