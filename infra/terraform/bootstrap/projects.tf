# GCP プロジェクト（dev / prod）、API、Terraform state のバケット、Artifact Registry

resource "google_project" "env" {
  for_each = local.envs

  project_id      = var.project_ids[each.key]
  name            = "mbta-live-${each.key}"
  billing_account = var.billing_account
  # 個人アカウントなので組織（Organization）もフォルダもない
  # default ネットワークは使わない（Cloud Run と Cloud SQL はネットワークを作らずに使う）
  auto_create_network = false
  labels = {
    app = "mbta-live"
    env = each.key
  }

  # terraform destroy や設定の誤りでプロジェクトごと消さない
  deletion_policy = "PREVENT"
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_project_service" "env" {
  for_each = local.project_services

  project = google_project.env[each.value.env].project_id
  service = each.value.service
  # API を無効にすると、その API のリソースが動かなくなるので、destroy でも無効にしない
  disable_on_destroy = false
}

# Terraform state のバケット: envs/dev は dev、envs/prod と bootstrap は prod のプロジェクトに置く。
# envs の backend は bucket を -backend-config で渡す（名前の決まり: <プロジェクト ID>-tfstate）
resource "google_storage_bucket" "tfstate" {
  for_each = local.envs

  project                     = google_project.env[each.key].project_id
  name                        = "${var.project_ids[each.key]}-tfstate"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  # 古い世代は 30 日で消す（最新の世代は残る）
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.env]
}

resource "google_storage_bucket" "bootstrap_tfstate" {
  project                     = google_project.env["prod"].project_id
  name                        = "${var.project_ids.prod}-bootstrap-tfstate"
  location                    = upper(var.region)
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.env]
}

# イメージは prod のプロジェクトに 1 つだけ置き、dev からも pull する
resource "google_artifact_registry_repository" "images" {
  project       = google_project.env["prod"].project_id
  location      = var.region
  repository_id = "mbta-live"
  format        = "DOCKER"
  description   = "web とジョブ共通のイメージ（タグ = git SHA）"

  # 古いイメージの自動削除（cleanup_policies）は入れない。prod で動いているイメージを消すと、
  # インスタンスを新しく起動できなくなるため（research.md）

  depends_on = [google_project_service.env]
}
