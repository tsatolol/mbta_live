# Workload Identity Federation: GitHub Actions の OIDC トークンで、サービスアカウントのキーを使わずに認証する。
# PR 用の provider は作らない（PR のチェックは GCP を使わない）。
#
# どのジョブがどの SA を使えるかは、pool を分けて、provider の attribute condition で絞る（iam.tf では pool 全体に付ける）:
#   pool github（dev / prod の各プロジェクト） … このリポジトリの main で、environment が <env> のジョブだけ → deployer-<env>
#   pool github-ci（prod のプロジェクト）       … このリポジトリの main のジョブ（ci） → ci-builder
#
# 最初は sub クレーム（repo:<owner>/<repo>:environment:<env> など）で 1 つに絞っていたが、ci-builder の利用が
# getAccessToken で拒否された（research.md の「WIF の絞り込み」）。sub の形に頼らない方式にした。

locals {
  # このリポジトリの main 以外（他のリポジトリ、他のブランチ、フォークからの PR）は、トークンの交換の時点で拒否する
  wif_main_condition = "assertion.repository == \"${local.repository}\" && assertion.ref == \"refs/heads/main\""

  wif_attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
}

# ---- deployer 用（環境ごと）

resource "google_iam_workload_identity_pool" "github" {
  for_each = local.envs

  project                   = google_project.env[each.key].project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "${local.repository} の main の、environment が ${each.key} のジョブ"

  depends_on = [google_project_service.env]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  for_each = local.envs

  project                            = google_project.env[each.key].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[each.key].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = local.wif_attribute_mapping
  # environment のないジョブ（ci）や、別の environment のジョブは拒否する
  attribute_condition = "${local.wif_main_condition} && \"environment\" in assertion && assertion.environment == \"${each.key}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# ---- ci-builder 用（prod のプロジェクト）

resource "google_iam_workload_identity_pool" "github_ci" {
  project                   = google_project.env["prod"].project_id
  workload_identity_pool_id = "github-ci"
  display_name              = "GitHub Actions (ci)"
  description               = "${local.repository} の main のジョブ（ci-builder）"

  depends_on = [google_project_service.env]
}

resource "google_iam_workload_identity_pool_provider" "github_ci" {
  project                            = google_project.env["prod"].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github_ci.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions (ci)"

  attribute_mapping   = local.wif_attribute_mapping
  attribute_condition = local.wif_main_condition

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  # pool 全体（その pool の provider の条件を満たしたトークン）
  wif_principal_environment = {
    for env in local.envs :
    env => "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[env].name}/*"
  }
  wif_principal_ci = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github_ci.name}/*"
}
