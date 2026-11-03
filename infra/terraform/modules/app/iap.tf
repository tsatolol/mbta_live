# IAP: Cloud Run に直接組み込む方式（web.tf の iap_enabled）。
# web を開けるユーザー（IAP で許可するユーザーと smoke-tester）は、bootstrap がプロジェクト単位で付ける（bootstrap/iap.tf）

# IAP のサービスエージェントが web を呼べるようにする（IAP を通ったリクエストだけが届く）
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-iap.iam.gserviceaccount.com"
}
