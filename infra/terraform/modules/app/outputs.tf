output "web_service_name" {
  description = "web の Cloud Run サービス名（URL はパイプラインが gcloud run services describe で取得する）"
  value       = google_cloud_run_v2_service.web.name
}

output "job_names" {
  description = "Cloud Run Jobs の名前"
  value       = { for k, job in google_cloud_run_v2_job.job : k => job.name }
}

output "sql_instance" {
  description = "Cloud SQL のインスタンス名（パイプラインのバックアップで使う）"
  value       = google_sql_database_instance.main.name
}
