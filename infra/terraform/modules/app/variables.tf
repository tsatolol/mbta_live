variable "env" {
  description = "環境名（dev / prod）。APP_ENV になる"
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "env は dev か prod。"
  }
}

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
  description = "最初に作るときのイメージ（ダイジェスト指定）。以降はパイプラインが gcloud で更新するので、Terraform は変更を無視する"
  type        = string
}

variable "iap_members" {
  description = "IAP で許可するユーザー（例: [\"user:you@example.com\"]）"
  type        = list(string)
  sensitive   = true
}

variable "smoke_tester_email" {
  description = "smoke-tester の SA（bootstrap が作る）。IAP のアクセス権を付ける"
  type        = string
}

variable "collector_schedule" {
  description = "collector の Cloud Scheduler の cron（America/New_York）"
  type        = string
}

variable "raw_retention_days" {
  description = "生データの保持日数（RAW_RETENTION_DAYS）"
  type        = number
}

variable "db_tier" {
  description = "Cloud SQL のマシンタイプ"
  type        = string
  default     = "db-f1-micro"
}

variable "db_backup_retained_count" {
  description = "Cloud SQL の自動バックアップを残す数（1 日 1 回なので日数と同じ）"
  type        = number
}

variable "db_deletion_protection" {
  description = "Cloud SQL を Terraform と API の両方で削除できないようにする"
  type        = bool
}

variable "mbta_api_key_enabled" {
  description = "Secret Manager の MBTA_API_KEY をジョブに渡すか。シークレットに値（バージョン）を入れるまでは false にする（quickstart.md）"
  type        = bool
  default     = false
}

variable "web_max_instances" {
  description = "web の最大インスタンス数"
  type        = number
  default     = 2
}
