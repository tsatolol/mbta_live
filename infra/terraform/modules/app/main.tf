# アプリ一式（Cloud SQL、Secret Manager、Cloud Run の web と Jobs、Cloud Scheduler、IAP、実行用の SA）。
# dev と prod は envs/ から同じモジュールを呼び、違いは変数だけで表す（FR-002）。
#
#   sql.tf        Cloud SQL（PostgreSQL 16）
#   secrets.tf    Secret Manager（DB パスワード、MBTA_API_KEY）
#   web.tf        Cloud Run サービス（web）
#   iap.tf        IAP
#   jobs.tf       Cloud Run Jobs（collector、sync-static、aggregate、migrate）
#   scheduler.tf  Cloud Scheduler

data "google_project" "this" {
  project_id = var.project_id
}

# ---- 実行用の SA

# web: Cloud SQL への接続と DB パスワードの読み取り（Web が DB を読むだけなのはアプリのコードで守る。憲章）
resource "google_service_account" "web" {
  project      = var.project_id
  account_id   = "web-runtime"
  display_name = "web の実行用"
}

# ジョブ: DB への接続、DB パスワードと MBTA_API_KEY の読み取り
resource "google_service_account" "jobs" {
  project      = var.project_id
  account_id   = "jobs-runtime"
  display_name = "Cloud Run Jobs の実行用"
}

# Cloud Scheduler: ジョブの実行だけ
resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "scheduler-invoker"
  display_name = "Cloud Scheduler からのジョブの実行"
}

resource "google_project_iam_member" "sql_client" {
  for_each = {
    web  = google_service_account.web.member
    jobs = google_service_account.jobs.member
  }

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = each.value
}

locals {
  # web とジョブで共通の DB の接続設定（src/lib/db/connection.ts が Unix ソケットの接続文字列を組み立てる）
  db_env = {
    APP_ENV                  = var.env
    INSTANCE_CONNECTION_NAME = google_sql_database_instance.main.connection_name
    DB_NAME                  = google_sql_database.app.name
    DB_USER                  = google_sql_user.app.name
  }
}
