# クイックスタート: 環境を立ち上げる

## 1. 事前に用意するもの（人が行う）

- GCP プロジェクトを 2 つ（dev / prod）作り、請求先アカウントをひも付ける
- MBTA API キーを 2 つ（dev 用 / prod 用）取得する
- GitHub に Environment `dev` と `prod` を作る。`prod` に Required reviewers（オーナー）を設定し、両方とも Deployment branches を `main` だけにする
- main にブランチ保護を設定する: PR 経由のマージだけを許可、`pr-checks` の合格を必須、force push と削除を禁止（承認者の人数は 0）
- secret scanning と Dependabot alerts を有効にする

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

PR を作ってマージすると、CI → dev へのデプロイ → スモークテスト → dev での E2E が自動で進む。ci のジョブサマリーで、今回出るコミット・マイグレーション・インフラの変更を確認してから、GitHub の Actions 画面で prod へのデプロイを承認する。

## ロールバック

GitHub の Actions 画面から `rollback.yml` を実行する。環境だけを指定すると web を直前のリビジョンに戻し、イメージのダイジェストも指定するとジョブも含めてそのイメージに戻す（prod では承認が必要）。
