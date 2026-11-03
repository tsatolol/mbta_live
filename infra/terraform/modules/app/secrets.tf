# Secret Manager: DB パスワードと MBTA_API_KEY

resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = "DB_PASSWORD"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret                 = google_secret_manager_secret.db_password.id
  secret_data_wo         = ephemeral.random_password.db.result
  secret_data_wo_version = local.db_password_version
}

# MBTA API キーは入れ物だけ作る。値は人が gcloud secrets versions add で入れる（Terraform の変数で渡すと state に残るため）。
# 値を入れたら mbta_api_key_enabled = true にして、ジョブに渡す（quickstart.md）
resource "google_secret_manager_secret" "mbta_api_key" {
  project   = var.project_id
  secret_id = "MBTA_API_KEY"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "db_password" {
  for_each = {
    web  = google_service_account.web.member
    jobs = google_service_account.jobs.member
  }

  project   = var.project_id
  secret_id = google_secret_manager_secret.db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value
}

# MBTA API を呼ぶのはジョブだけ（憲章）
resource "google_secret_manager_secret_iam_member" "mbta_api_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.mbta_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.jobs.member
}
