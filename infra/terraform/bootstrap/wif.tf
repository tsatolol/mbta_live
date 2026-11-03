# Workload Identity Federation: GitHub Actions の OIDC トークンで、サービスアカウントのキーを使わずに認証する。
# 各プロジェクトに pool / provider を 1 つずつ作る。PR 用の provider は作らない（PR のチェックは GCP を使わない）。
#
# どのジョブがどの SA を使えるかは、OIDC トークンの sub クレームで絞る（iam.tf）:
#   environment を指定したジョブ: repo:<owner>/<repo>:environment:<dev|prod>
#   environment のないジョブ（ci）: repo:<owner>/<repo>:ref:refs/heads/main

resource "google_iam_workload_identity_pool" "github" {
  for_each = local.envs

  project                   = google_project.env[each.key].project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "${local.repository} の main からのワークフロー"

  depends_on = [google_project_service.env]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  for_each = local.envs

  project                            = google_project.env[each.key].project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[each.key].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # このリポジトリの main 以外（他のリポジトリ、他のブランチ、フォークからの PR）は、トークンの交換の時点で拒否する
  attribute_condition = "assertion.repository == \"${local.repository}\" && assertion.ref == \"refs/heads/main\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

locals {
  # sub クレームで 1 つに絞った principal
  wif_principal_environment = {
    for env in local.envs :
    env => "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github[env].name}/subject/repo:${local.repository}:environment:${env}"
  }
  wif_principal_ci = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.github["prod"].name}/subject/repo:${local.repository}:ref:refs/heads/main"
}
