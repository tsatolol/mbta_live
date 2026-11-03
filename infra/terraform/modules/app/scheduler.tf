# Cloud Scheduler: ジョブを定期的に実行する。時刻は America/New_York（docs/architecture.md）。

locals {
  schedules = {
    collector   = var.collector_schedule
    sync-static = "0 4 * * *"  # 毎日 04:00 ET
    aggregate   = "30 4 * * *" # 毎日 04:30 ET
  }
}

# Scheduler の SA にはジョブの実行権限だけを付ける
resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  for_each = local.schedules

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.job[each.key].name
  role     = "roles/run.invoker"
  member   = google_service_account.scheduler.member
}

resource "google_cloud_scheduler_job" "job" {
  for_each = local.schedules

  project   = var.project_id
  region    = var.region
  name      = each.key
  schedule  = each.value
  time_zone = "America/New_York"
  # Jobs の実行 API はすぐ応答する（実行の完了は待たない）
  attempt_deadline = "60s"

  # 失敗しても再試行しない（collector は次の回で取り直す）
  retry_config {
    retry_count = 0
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.job[each.key].id}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.scheduler]
}
