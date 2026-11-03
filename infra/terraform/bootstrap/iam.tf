# サービスアカウントと権限
#
#   ci-builder（prod）       ci ジョブ。イメージの push と、dev / prod の terraform plan（読み取りだけ）
#   deployer-<env>           cd-<env> と rollback。その環境の apply とデプロイ。environment が一致するジョブだけが使える
#   smoke-tester（環境ごと） スモークテスト、dev の E2E、稼働時間チェック。IAP のアクセス権だけ（iap.tf）
#
# アプリの実行用の SA（web、ジョブ、Scheduler）は modules/app で作る。

# ---- ci-builder

resource "google_service_account" "ci_builder" {
  project      = google_project.env["prod"].project_id
  account_id   = "ci-builder"
  display_name = "CI: イメージの push と terraform plan"

  depends_on = [google_project_service.env]
}

resource "google_service_account_iam_member" "ci_builder_wif" {
  service_account_id = google_service_account.ci_builder.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_ci
}

resource "google_artifact_registry_repository_iam_member" "ci_builder_push" {
  project    = google_artifact_registry_repository.images.project
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.ci_builder.member
}

# plan のための読み取り。plan は -lock=false で実行するので、state のバケットは読み取りだけでよい
resource "google_project_iam_member" "ci_builder_plan" {
  for_each = {
    for pair in setproduct(local.envs, [
      "roles/viewer",
      "roles/iam.securityReviewer",
      "roles/serviceusage.serviceUsageConsumer",
    ]) : "${pair[0]}/${pair[1]}" => { env = pair[0], role = pair[1] }
  }

  project = google_project.env[each.value.env].project_id
  role    = each.value.role
  member  = google_service_account.ci_builder.member
}

resource "google_storage_bucket_iam_member" "ci_builder_state_read" {
  for_each = local.envs

  bucket = google_storage_bucket.tfstate[each.key].name
  role   = "roles/storage.objectViewer"
  member = google_service_account.ci_builder.member
}

# ---- deployer-<env>

resource "google_service_account" "deployer" {
  for_each = local.envs

  project      = google_project.env[each.key].project_id
  account_id   = "deployer-${each.key}"
  display_name = "CD: ${each.key} の apply とデプロイ"

  depends_on = [google_project_service.env]
}

resource "google_service_account_iam_member" "deployer_wif" {
  for_each = local.envs

  service_account_id = google_service_account.deployer[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.wif_principal_environment[each.key]
}

# modules/app の apply（Cloud Run、Cloud SQL、Secret Manager、Scheduler、IAP、実行用の SA とその権限、監視）と、
# デプロイ（gcloud run deploy / jobs update / jobs execute、Cloud SQL のバックアップ）に要る権限
resource "google_project_iam_member" "deployer" {
  for_each = {
    for pair in setproduct(local.envs, [
      "roles/cloudscheduler.admin",
      "roles/cloudsql.admin",
      "roles/iam.serviceAccountAdmin",
      "roles/iam.serviceAccountUser",
      "roles/iap.admin",
      "roles/logging.configWriter",
      "roles/monitoring.editor",
      "roles/resourcemanager.projectIamAdmin",
      "roles/run.admin",
      "roles/secretmanager.admin",
      "roles/serviceusage.serviceUsageConsumer",
    ]) : "${pair[0]}/${pair[1]}" => { env = pair[0], role = pair[1] }
  }

  project = google_project.env[each.value.env].project_id
  role    = each.value.role
  member  = google_service_account.deployer[each.value.env].member
}

resource "google_storage_bucket_iam_member" "deployer_state" {
  for_each = local.envs

  bucket = google_storage_bucket.tfstate[each.key].name
  role   = "roles/storage.objectAdmin"
  member = google_service_account.deployer[each.key].member
}

# Cloud Run のサービスとジョブを作る・更新するとき、呼び出した deployer 自身にもイメージを読む権限が要る
# （パイプラインの 3 回目の実行で、deployer-dev が downloadArtifacts を拒否された。research.md）
resource "google_artifact_registry_repository_iam_member" "deployer_pull" {
  for_each = local.envs

  project    = google_artifact_registry_repository.images.project
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = google_service_account.deployer[each.key].member
}

# ---- smoke-tester（環境ごと）

resource "google_service_account" "smoke_tester" {
  for_each = local.envs

  project      = google_project.env[each.key].project_id
  account_id   = "smoke-tester"
  display_name = "スモークテスト・E2E・稼働時間チェック（IAP のアクセス権だけ）"

  depends_on = [google_project_service.env]
}

# deployer が smoke-tester の ID トークンを発行して、IAP を通したスモークテストを行う
resource "google_service_account_iam_member" "deployer_smoke_token" {
  for_each = local.envs

  service_account_id = google_service_account.smoke_tester[each.key].name
  role               = "roles/iam.serviceAccountOpenIdTokenCreator"
  member             = google_service_account.deployer[each.key].member
}

# ---- dev から prod の Artifact Registry のイメージを pull する

resource "google_artifact_registry_repository_iam_member" "dev_run_pull" {
  project    = google_artifact_registry_repository.images.project
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  # Cloud Run のサービスエージェントは、run.googleapis.com を有効にしたときに作られる
  member = "serviceAccount:service-${google_project.env["dev"].number}@serverless-robot-prod.iam.gserviceaccount.com"

  depends_on = [google_project_service.env]
}
