# 監視の通知先（メール）。アラートポリシー（envs、T040〜T041）は表示名でこのチャンネルを探す

resource "google_monitoring_notification_channel" "email" {
  for_each = local.envs

  project      = google_project.env[each.key].project_id
  display_name = "mbta-live alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.env]
}
