output "project_ids" {
  description = "環境ごとの GCP プロジェクト ID"
  value       = { for env in local.envs : env => google_project.env[env].project_id }
}

output "tfstate_buckets" {
  description = "envs の backend に -backend-config=\"bucket=...\" で渡すバケット"
  value       = { for env in local.envs : env => google_storage_bucket.tfstate[env].name }
}

output "bootstrap_tfstate_bucket" {
  description = "bootstrap 自身の state を移すバケット（backend.tf.example）"
  value       = google_storage_bucket.bootstrap_tfstate.name
}

output "artifact_registry" {
  description = "イメージの置き場所（GitHub の variables の ARTIFACT_REGISTRY と同じ値）"
  value       = github_actions_variable.repo["ARTIFACT_REGISTRY"].value
}

output "workload_identity_providers" {
  description = "WIF provider（環境ごとの deployer 用と、ci-builder 用）"
  value = merge(
    { for env in local.envs : env => google_iam_workload_identity_pool_provider.github[env].name },
    { ci = google_iam_workload_identity_pool_provider.github_ci.name },
  )
}

output "service_accounts" {
  description = "パイプラインが使う SA"
  value = {
    ci_builder   = google_service_account.ci_builder.email
    deployer     = { for env in local.envs : env => google_service_account.deployer[env].email }
    smoke_tester = { for env in local.envs : env => google_service_account.smoke_tester[env].email }
  }
}
