# Quickstart: 環境を立ち上げる

## 1. 事前に用意するもの（人が行う）

- GCP プロジェクトを 2 つ（dev / prod）作り、請求先アカウントをひも付ける
- MBTA API キーを 2 つ（dev 用 / prod 用）取得する
- GitHub に Environment `dev` と `prod` を作る。`prod` に Required reviewers（オーナー）を設定し、両方とも Deployment branches を `main` だけにする

## 2. bootstrap（最初に一度だけ）

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply -var="dev_project_id=<dev>" -var="prod_project_id=<prod>"
```

出力された WIF provider と SA のメールアドレスを、GitHub の Environment の variables に登録する（`specs/004-infra-cicd/contracts/pipeline.md`）。

## 3. 秘密の値を入れる

- 各プロジェクトの Secret Manager に MBTA API キーを入れる
- GitHub の Environment の secrets に `TF_VAR_iap_members`（IAP で許可するユーザー）を入れる

## 4. 最初のデプロイ

main に push すると、CI → dev へのデプロイが自動で進む。dev で確認できたら、GitHub の Actions 画面で prod へのデプロイを承認する。

## ロールバック

GitHub の Actions 画面から `rollback.yml` を実行し、環境と戻したいイメージのダイジェストを指定する（prod では承認が必要）。
