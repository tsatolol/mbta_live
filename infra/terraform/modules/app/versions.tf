# アプリ一式のモジュールが使うプロバイダ。バージョンの固定は呼び出す側（envs/dev, envs/prod）と合わせる
terraform {
  required_version = "~> 1.17"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.9"
    }
    # DB パスワードの生成（T011）に使う
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
