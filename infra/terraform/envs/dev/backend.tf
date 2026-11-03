# state は dev のプロジェクトの GCS バケットに置く（bootstrap が作る）
terraform {
  backend "gcs" {
    bucket = "mbta-live-dev-76bt-tfstate"
    prefix = "envs/dev"
  }
}
