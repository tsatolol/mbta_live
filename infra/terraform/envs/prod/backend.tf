# state は prod のプロジェクトの GCS バケットに置く。bucket（<プロジェクト ID>-tfstate）は
# プロジェクト ID がコミットされていないので、init のときに渡す:
#   terraform init -backend-config="bucket=${GCP_PROJECT_ID}-tfstate"
terraform {
  backend "gcs" {
    prefix = "envs/prod"
  }
}
