# dev の値（公開してよい値だけ。docs/architecture.md の「環境の違い」）
project_id               = "mbta-live-dev-76bt"
collector_schedule       = "*/5 * * * *"
raw_retention_days       = 3
db_backup_retained_count = 1
db_deletion_protection   = false
# Secret Manager の MBTA_API_KEY に値を入れたので true（quickstart.md の「3. MBTA API キーを入れる」）
mbta_api_key_enabled = true
# 監視: dev は通知しない（画面で見る）。collector は 5 分間隔なので、15 分成功がなければアラート
alert_notifications_enabled = false
collector_absence_seconds   = 900
