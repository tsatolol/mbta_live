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

variable "alert_notifications_enabled" {
  description = "アラートポリシーの通知をメールに送るか（prod は true。dev は通知せず、Cloud Monitoring の画面で見るだけ）"
  type        = bool
}

variable "collector_absence_seconds" {
  description = "collector の成功がこの秒数ないとアラートにする（prod は 1 分間隔なので 180 秒。dev は 5 分間隔なので長くする）"
  type        = number
}
