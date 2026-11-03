# IAP で web を開けるユーザー。プロジェクト単位で付けるので、Cloud Run の web（envs が作る）にも効く。
# envs ではなく bootstrap で付けるのは、メールアドレスを envs の入力（public リポジトリと ci の plan）に置かないため（research.md）

resource "google_project_iam_binding" "iap_access" {
  for_each = local.envs

  project = google_project.env[each.key].project_id
  role    = "roles/iap.httpsResourceAccessor"
  members = concat(var.iap_members[each.key], [google_service_account.smoke_tester[each.key].member])
}

# 組織のないプロジェクトでは、Google が用意する OAuth クライアントを IAP が使えず、web が IAP の 502
# （Empty Google Account OAuth client ID(s)/secret(s)）を返す。自分で作った OAuth クライアントをプロジェクト単位の
# IAP の設定に入れる（research.md の「IAP の OAuth クライアント」）。クライアントの secret は bootstrap の state に残る
locals {
  # 環境の名前は秘密の値ではない
  iap_oauth_envs = toset(nonsensitive(keys(var.iap_oauth_clients)))
}

resource "google_iap_settings" "oauth" {
  for_each = local.iap_oauth_envs

  name = "projects/${google_project.env[each.key].number}/iap_web"
  access_settings {
    oauth_settings {
      client_id     = var.iap_oauth_clients[each.key].client_id
      client_secret = var.iap_oauth_clients[each.key].client_secret
    }
  }

  depends_on = [google_project_service.env]
}
