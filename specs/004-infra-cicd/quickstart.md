# クイックスタート: 環境を立ち上げる

## 1. 事前に用意するもの（人が行う）

- 請求先アカウントの ID（Cloud Console の「お支払い」で確かめる。コミットしない）
- dev / prod のプロジェクト ID（GCP 全体で一意。プロジェクトは bootstrap が作る）
- MBTA API キーを 2 つ（dev 用 / prod 用。https://api-v3.mbta.com で登録）
- GitHub の fine-grained personal access token（対象はこのリポジトリだけ、権限は Administration・Environments・Secrets・Variables の読み書き。bootstrap の apply が終わったら削除する）

GitHub の Environment・variables・secrets・ルールセット・セキュリティ設定は bootstrap が作るので、画面での操作はいらない。

## 2. bootstrap（最初に一度だけ）

```bash
gcloud auth application-default login            # 請求先アカウントのユーザー権限がある Google アカウント
export GITHUB_TOKEN=<fine-grained personal access token>
export TF_VAR_billing_account=<請求先アカウントの ID>
export TF_VAR_iap_members='["user:you@example.com"]'   # IAP で許可するユーザー（GitHub の Environment の secrets に入る）
export TF_VAR_alert_email=<監視の通知先>

cd infra/terraform/bootstrap
cp terraform.tfvars.example terraform.tfvars   # プロジェクト ID などを書く（このファイルはコミットしない）
terraform init
terraform plan                                  # 作られるもの（プロジェクト、バケット、WIF、SA、GitHub の設定）を確かめる
terraform apply

# state を GCS に移す
cp backend.tf.example backend.tf
terraform init -migrate-state

# ロックファイルを作って PR でコミットする
terraform providers lock -platform=linux_amd64 -platform=darwin_arm64
```

apply が終わったら、GitHub のトークンを削除する（bootstrap を変更するときに作り直す）。

## 3. MBTA API キーを入れる

envs の初回の apply（main へのマージで動く cd-dev / cd-prod）で、各プロジェクトに Secret Manager のシークレット `MBTA_API_KEY` の入れ物ができる。その後に値を入れる。

```bash
printf '%s' '<dev 用のキー>'  | gcloud secrets versions add MBTA_API_KEY --project=<dev のプロジェクト ID>  --data-file=-
printf '%s' '<prod 用のキー>' | gcloud secrets versions add MBTA_API_KEY --project=<prod のプロジェクト ID> --data-file=-
```

## 4. 最初のデプロイ

PR を作ってマージすると、CI → dev へのデプロイ → スモークテスト → dev での E2E が自動で進む。ci のジョブサマリーで、今回出るコミット・マイグレーション・インフラの変更を確認してから、GitHub の Actions 画面で prod へのデプロイを承認する。

## ロールバック

GitHub の Actions 画面から `rollback.yml` を実行する。環境だけを指定すると web を直前のリビジョンに戻し、イメージのダイジェストも指定するとジョブも含めてそのイメージに戻す（prod では承認が必要）。
