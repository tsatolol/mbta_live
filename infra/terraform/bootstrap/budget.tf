# 予算アラート（FR-012）。予算は請求先アカウントのリソースなので、パイプラインの deployer（プロジェクトの権限だけ）
# ではなく、請求先アカウントの権限がある人が bootstrap で作る（research.md）。
# 予算の 50%・90%・100%（と、月末の見込みが 100%）で、監視の通知チャンネル（monitoring.tf）と請求先アカウントの管理者にメールが届く。

# Billing Budget API は、ユーザーの認証情報で呼ぶときに割り当てのプロジェクトが要るので、prod のプロジェクトを使う
provider "google" {
  alias                 = "billing"
  region                = var.region
  user_project_override = true
  billing_project       = var.project_ids.prod
}

resource "google_billing_budget" "env" {
  provider = google.billing
  for_each = var.monthly_budgets

  billing_account = var.billing_account
  display_name    = "mbta-live-${each.key}"

  budget_filter {
    projects = ["projects/${google_project.env[each.key].number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency_code
      units         = tostring(floor(each.value))
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = [google_monitoring_notification_channel.email[each.key].id]
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.env]
}
