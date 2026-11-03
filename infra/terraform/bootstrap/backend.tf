# bootstrap の state は prod のプロジェクトの GCS バケットに置く（T010 で、最初のローカルの state から移した）
terraform {
  backend "gcs" {
    bucket = "mbta-live-prod-76bt-bootstrap-tfstate"
    prefix = "bootstrap"
  }
}
