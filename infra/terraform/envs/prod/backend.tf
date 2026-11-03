# state は prod のプロジェクトの GCS バケットに置く（bootstrap が作る）
terraform {
  backend "gcs" {
    bucket = "mbta-live-prod-76bt-tfstate"
    prefix = "envs/prod"
  }
}
