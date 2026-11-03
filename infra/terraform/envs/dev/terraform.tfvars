# dev の値（公開してよい値だけ。docs/architecture.md の「環境の違い」）
collector_schedule       = "*/5 * * * *"
raw_retention_days       = 3
db_backup_retained_count = 1
db_deletion_protection   = false
# Secret Manager の MBTA_API_KEY に値を入れたら true にする（quickstart.md）
mbta_api_key_enabled = false
