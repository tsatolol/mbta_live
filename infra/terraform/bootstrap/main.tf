# bootstrap: パイプラインの前提になるものを作る。最初に一度だけ、人がご自身の権限で apply する
# （specs/004-infra-cicd/quickstart.md）。それ以外はパイプラインが envs/ を apply する。
#
#   projects.tf  GCP プロジェクト、API、state のバケット、Artifact Registry
#   wif.tf       Workload Identity Federation（GitHub Actions からの認証）
#   iam.tf       サービスアカウントと権限
#   iap.tf       IAP で web を開けるユーザー（プロジェクト単位）
#   monitoring.tf 監視の通知先
#   github.tf    GitHub の Environment・variables・ルールセット・セキュリティ設定
#   imports.tf   画面で作った GitHub の設定の取り込み

provider "google" {
  region = var.region
  # 認証は gcloud auth application-default login のユーザー（請求先アカウントのユーザー権限があるもの）
}

provider "github" {
  owner = var.github_owner
  # トークンは環境変数 GITHUB_TOKEN で渡す
}

locals {
  envs = toset(["dev", "prod"])

  repository = "${var.github_owner}/${var.github_repository}"

  # 両方のプロジェクトで有効にする API
  services = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
  ])

  project_services = {
    for pair in setproduct(local.envs, local.services) :
    "${pair[0]}/${pair[1]}" => { env = pair[0], service = pair[1] }
  }
}
