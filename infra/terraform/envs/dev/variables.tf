# プロジェクト ID・イメージ・IAP で許可するユーザーは、パイプラインが環境変数で渡す:
#   TF_VAR_project_id   … GitHub の Environment の variable GCP_PROJECT_ID（bootstrap が登録）
#   TF_VAR_image        … CI でビルドしたイメージ（ダイジェスト指定）
#   TF_VAR_iap_members  … GitHub の Environment の secret（bootstrap が登録）
# それ以外の環境ごとの値は terraform.tfvars（公開してよい値だけ）。

variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "region" {
  description = "リージョン"
  type        = string
  default     = "us-east4"
}

variable "image" {
  description = "最初に作るときのイメージ（ダイジェスト指定）。以降はパイプラインが更新する"
  type        = string
}

variable "iap_members" {
  description = "IAP で許可するユーザー"
  type        = list(string)
  sensitive   = true
}

variable "collector_schedule" {
  description = "collector の cron（America/New_York）"
  type        = string
}

variable "raw_retention_days" {
  description = "生データの保持日数"
  type        = number
}

variable "db_backup_retained_count" {
  description = "Cloud SQL の自動バックアップを残す数"
  type        = number
}

variable "db_deletion_protection" {
  description = "Cloud SQL の削除保護"
  type        = bool
}

variable "mbta_api_key_enabled" {
  description = "Secret Manager の MBTA_API_KEY をジョブに渡すか（値を入れてから true にする）"
  type        = bool
}
