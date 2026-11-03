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
  description = "環境ごとの IAP で許可するユーザー（例: { dev = [\"user:you@example.com\"], prod = [\"user:you@example.com\"] }）。プロジェクト単位で IAP のアクセス権を付ける（iap.tf）"
  type = object({
    dev  = list(string)
    prod = list(string)
  })
  sensitive = true
}

variable "alert_email" {
  description = "監視の通知先のメールアドレス。各プロジェクトの通知チャンネルになる（iap.tf と同じく bootstrap が作る。monitoring.tf）"
  type        = string
  sensitive   = true
}

variable "iap_oauth_clients" {
  description = <<-EOT
    環境ごとの IAP の OAuth クライアント（Cloud Console の Google Auth Platform で作った Web アプリケーションのクライアント）。
    組織のないプロジェクトでは Google が用意するクライアントを IAP が使えないので、自分で作ったものを設定する（quickstart.md）。
    作った環境だけを書けばよい。例: { dev = { client_id = "...", client_secret = "..." } }。コミットしない
  EOT
  type = map(object({
    client_id     = string
    client_secret = string
  }))
  default   = {}
  sensitive = true
}

variable "monthly_budgets" {
  description = <<-EOT
    環境ごとの月の予算（予算アラート。FR-012）。金額は請求先アカウントの通貨で書く（通貨は budget_currency_code）。
    書いた環境だけ予算を作る。例: { dev = 1000, prod = 3000 }
  EOT
  type        = map(number)
  default     = {}
}

variable "budget_currency_code" {
  description = "予算の通貨（請求先アカウントの通貨と同じにする。例: JPY、USD）"
  type        = string
  default     = "JPY"
}
