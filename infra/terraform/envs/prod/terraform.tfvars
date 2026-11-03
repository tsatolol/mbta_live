# prod の値（公開してよい値だけ。docs/architecture.md の「環境の違い」）
project_id               = "mbta-live-prod-76bt"
collector_schedule       = "* * * * *"
raw_retention_days       = 28
db_backup_retained_count = 7
db_deletion_protection   = true
# Secret Manager の MBTA_API_KEY に値を入れたら true にする（quickstart.md）
mbta_api_key_enabled = false
# 監視（FR-013）: 通知する。collector は 1 分間隔なので、3 分成功がなければ通知
alert_notifications_enabled = true
collector_absence_seconds   = 180
