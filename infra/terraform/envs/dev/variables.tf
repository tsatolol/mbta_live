# 環境ごとの値は terraform.tfvars（公開してよい値だけ）。イメージだけはパイプラインが環境変数で渡す:
#   TF_VAR_image … CI でビルドしたイメージ（ダイジェスト指定）
# 秘密の値・個人の情報（IAP で許可するユーザー、通知先）は envs の入力にしない（bootstrap が GCP に直接設定する）。
# ci ジョブ（environment なし。Environment の variables / secrets を読めない）でも plan を作れるようにするため

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
