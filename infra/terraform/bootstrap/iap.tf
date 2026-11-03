# IAP で web を開けるユーザー。プロジェクト単位で付けるので、Cloud Run の web（envs が作る）にも効く。
# envs ではなく bootstrap で付けるのは、メールアドレスを envs の入力（public リポジトリと ci の plan）に置かないため（research.md）

resource "google_project_iam_binding" "iap_access" {
  for_each = local.envs

  project = google_project.env[each.key].project_id
  role    = "roles/iap.httpsResourceAccessor"
  members = concat(var.iap_members[each.key], [google_service_account.smoke_tester[each.key].member])
}
