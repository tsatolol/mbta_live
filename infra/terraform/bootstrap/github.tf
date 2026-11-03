# GitHub の設定（specs/004-infra-cicd/contracts/pipeline.md の「GitHub の設定」）。画面で変えない。
# トークンは環境変数 GITHUB_TOKEN（fine-grained personal access token。このリポジトリだけ、
# Administration・Environments・Secrets・Variables の読み書き）。apply の後に削除する。
#
# 開発環境からは GitHub プロバイダを取得できないので、変更したらローカルの terraform plan で確かめてから apply する。

data "github_user" "prod_reviewer" {
  username = var.prod_reviewer
}

locals {
  # 各 Environment の variables（値は GCP 側のリソースから取るので、写し間違いが起きない）
  environment_variables = {
    for pair in setproduct(local.envs, ["GCP_PROJECT_ID", "WIF_PROVIDER", "DEPLOYER_SA", "SMOKE_TESTER_SA"]) :
    "${pair[0]}/${pair[1]}" => {
      env  = pair[0]
      name = pair[1]
      value = {
        GCP_PROJECT_ID  = google_project.env[pair[0]].project_id
        WIF_PROVIDER    = google_iam_workload_identity_pool_provider.github[pair[0]].name
        DEPLOYER_SA     = google_service_account.deployer[pair[0]].email
        SMOKE_TESTER_SA = google_service_account.smoke_tester[pair[0]].email
      }[pair[1]]
    }
  }
}

# ---- Environment

resource "github_repository_environment" "env" {
  for_each = local.envs

  repository  = var.github_repository
  environment = each.key
  # オーナーが 1 人なので、自分の変更を自分で承認できるようにする
  prevent_self_review = false

  # prod だけ承認が必要
  dynamic "reviewers" {
    for_each = each.key == "prod" ? [1] : []
    content {
      users = [data.github_user.prod_reviewer.id]
    }
  }

  # Deployment branches は main だけ
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "main_only" {
  for_each = local.envs

  repository     = var.github_repository
  environment    = github_repository_environment.env[each.key].environment
  branch_pattern = "main"
}

resource "github_actions_environment_variable" "env" {
  for_each = local.environment_variables

  repository    = var.github_repository
  environment   = github_repository_environment.env[each.value.env].environment
  variable_name = each.value.name
  value         = each.value.value
}

# Environment の secrets は置かない。IAP で許可するユーザーと通知先は bootstrap が GCP に直接設定する（iap.tf、monitoring.tf）。
# ci ジョブ（environment なし）が envs の plan を作れるように、envs の入力はリポジトリの中の値だけにしている（research.md）

# ---- リポジトリ全体の variables（ci ジョブが使う）

resource "github_actions_variable" "repo" {
  for_each = {
    ARTIFACT_REGISTRY = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${google_artifact_registry_repository.images.project}/${google_artifact_registry_repository.images.repository_id}"
    CI_BUILDER_SA     = google_service_account.ci_builder.email
    CI_WIF_PROVIDER   = google_iam_workload_identity_pool_provider.github["prod"].name
  }

  repository    = var.github_repository
  variable_name = each.key
  value         = each.value
}

# ---- main のルールセット（T021 で画面から作ったものを imports.tf で取り込む）

resource "github_repository_ruleset" "main" {
  name        = "main"
  repository  = var.github_repository
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    # 削除と force push を禁止する
    deletion         = true
    non_fast_forward = true

    # PR 経由のマージだけ。オーナー 1 人なので承認者の人数は 0
    pull_request {
      required_approving_review_count = 0
    }

    # pr-checks の合格を必須にする
    required_status_checks {
      required_check {
        context = "pr-checks"
      }
    }
  }
}

# ---- セキュリティ設定（Dependabot alerts、secret scanning と push protection）
# Dependency graph は API で設定できないので、画面で有効にしたまま使う（quickstart.md）。
# 既存のリポジトリを imports.tf で取り込み、ここに書いた項目だけを管理する。

resource "github_repository" "this" {
  name       = var.github_repository
  visibility = "public"

  vulnerability_alerts = true

  security_and_analysis {
    secret_scanning {
      status = "enabled"
    }
    secret_scanning_push_protection {
      status = "enabled"
    }
  }

  lifecycle {
    prevent_destroy = true
    # このファイルで管理しない設定は、画面の値のまま変えない
    ignore_changes = [
      allow_auto_merge,
      allow_merge_commit,
      allow_rebase_merge,
      allow_squash_merge,
      allow_update_branch,
      archive_on_destroy,
      auto_init,
      delete_branch_on_merge,
      description,
      has_discussions,
      has_downloads,
      has_issues,
      has_projects,
      has_wiki,
      homepage_url,
      merge_commit_message,
      merge_commit_title,
      pages,
      squash_merge_commit_message,
      squash_merge_commit_title,
      template,
      topics,
      web_commit_signoff_required,
    ]
  }
}
