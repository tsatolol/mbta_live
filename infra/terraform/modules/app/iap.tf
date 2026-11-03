# IAP: Cloud Run に直接組み込む方式（web.tf の iap_enabled）。許可したユーザーと smoke-tester だけが web を開ける（FR-011）。

# IAP のサービスエージェントが web を呼べるようにする（IAP を通ったリクエストだけが届く）
resource "google_cloud_run_v2_service_iam_member" "iap_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-iap.iam.gserviceaccount.com"
}

# 許可するユーザーはメールアドレスを含むので、plan の出力（public リポジトリの Actions のログ）に出ないよう、
# for_each のキーにせず binding の members（sensitive）で渡す
resource "google_iap_web_cloud_run_service_iam_binding" "access" {
  project                = var.project_id
  location               = var.region
  cloud_run_service_name = google_cloud_run_v2_service.web.name
  role                   = "roles/iap.httpsResourceAccessor"
  members                = concat(var.iap_members, ["serviceAccount:${var.smoke_tester_email}"])
}
