variable "billing_account" {
  description = "請求先アカウントの ID（XXXXXX-XXXXXX-XXXXXX）。コミットしない。TF_VAR_billing_account かコミットしない terraform.tfvars で渡す"
  type        = string
}

variable "project_ids" {
  description = "環境ごとの GCP プロジェクト ID（GCP 全体で一意）"
  type = object({
    dev  = string
    prod = string
  })
}

variable "region" {
  description = "リージョン"
  type        = string
  default     = "us-east4"
}

variable "github_owner" {
  description = "GitHub のリポジトリのオーナー"
  type        = string
  default     = "tsatolol"
}

variable "github_repository" {
  description = "GitHub のリポジトリ名"
  type        = string
  default     = "mbta_live"
}

variable "prod_reviewer" {
  description = "prod へのデプロイを承認する GitHub のユーザー名"
  type        = string
  default     = "tsatolol"
}

variable "main_ruleset_id" {
  description = "画面で作った main のルールセットの ID（imports.tf で取り込む）。GitHub の Settings → Rules → Rulesets で開いたときの URL の末尾の数字"
  type        = string
}

variable "iap_members" {
  description = "環境ごとの IAP で許可するユーザー（例: [\"user:you@example.com\"]）。GitHub の Environment の secret TF_VAR_iap_members になる"
  type = object({
    dev  = list(string)
    prod = list(string)
  })
  sensitive = true
}

variable "alert_email" {
  description = "監視の通知先のメールアドレス。GitHub の Environment の secret TF_VAR_alert_email になる"
  type        = string
  sensitive   = true
}
