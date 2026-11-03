# 実装計画: インフラと CI/CD

**ブランチ**: `004-infra-cicd` | **日付**: 2026-11-01 | **仕様**: [spec.md](./spec.md)

**入力**: `/specs/004-infra-cicd/spec.md` の機能仕様

## 概要（Summary）

Terraform で dev / prod の 2 つの GCP プロジェクトにアプリ一式を作る。GitHub Actions では、PR で軽いチェック（`pr-checks.yml`）を行い、マージ（= main の更新）ごとにリリース用のパイプライン（`pipeline.yml`）で CI を 1 回、CD を dev（自動）→ prod（承認後）の 2 回実行する。prod の web は、トラフィック 0% で確認してから切り替える。詳細は [contracts/pipeline.md](./contracts/pipeline.md)。

## 技術的な前提（Technical Context）

**言語/バージョン**: Terraform（HCL）、GitHub Actions（YAML）、Dockerfile

**主な依存関係**: Google provider、GitHub provider（`integrations/github`。bootstrap だけ）、google-github-actions/auth（WIF）、gcloud、Gitleaks、actions/dependency-review-action、Playwright

**ストレージ**: Terraform state は GCS バケット（envs は各環境のプロジェクト、bootstrap は prod プロジェクト）。bootstrap の初回だけはローカルの state で apply し、その後 GCS に移す

**テスト**: PR のチェック、`terraform fmt -check` / `validate` / `plan`、セキュリティ検査、コンテナの起動確認、マイグレーションの互換性テスト、デプロイ後のスモークテスト（IAP 経由の API と collector）、dev での E2E。要件は spec.md のテスト要件（Testing Requirements）

**実行環境**: Google Cloud（`us-east4`）: Cloud Run（サービス + Jobs）、Cloud SQL（PostgreSQL 16）、Cloud Scheduler、Secret Manager、Artifact Registry、IAP

**プロジェクトの種類**: インフラ / CI/CD

**制約**: 最小構成。public リポジトリなので秘密の値をログ・artifact・tfvars に置かない

**規模/範囲**: 2 環境 × アプリ一式

### 環境の違い

dev と prod の違い（間隔、保持期間、Cloud SQL の設定など）は [docs/architecture.md](../../docs/architecture.md#環境の違い) を参照。値は `envs/<env>/terraform.tfvars` で表す。

### ジョブの設定

スケジュールは Cloud Scheduler の `America/New_York` で指定する（時刻は docs/architecture.md）。

- collector: タスクのタイムアウト 50 秒、リトライ 0。重なった実行は `pg_try_advisory_lock` で後の実行がすぐ終了する
- web: `min-instances=0`。prod のデプロイは `--no-traffic --tag candidate` で行い、スモークテストの後にトラフィックを切り替える（dev は直接 100%）
- イメージはパイプラインが更新するので、Terraform では `lifecycle { ignore_changes = [image] }`

### データ品質の監視（FR-013）

- ジョブは件数・解析失敗の行数・未解決の駅 ID の数を構造化ログに出す。Cloud Logging のログベースの指標にし、Cloud Monitoring のアラートポリシーで通知する（通知先はメール）
- 最後の収集成功からの経過時間と前日分の集計の完了は、`/api/health` を Cloud Monitoring の稼働時間チェックで見る（IAP の背後にあるので、監視用 SA に IAP のアクセス権を付ける。方式は実装時に検証する）
- web の 5xx の割合（5 分間で 5% 超）と応答時間（p95 が 3 秒超）は、Cloud Run の組み込みの指標でアラートポリシーを作る（FR-020）
- dev では通知せず、ダッシュボードで見るだけにする

### テスト用・監視用の SA

- `smoke-tester`（環境ごと）: IAP のアクセス権（`roles/iap.httpsResourceAccessor`）だけを持つ。パイプラインのスモークテスト、dev の E2E、Cloud Monitoring の稼働時間チェックで ID トークンを発行して使う
- deployer は `smoke-tester` の ID トークンを発行できる（`roles/iam.serviceAccountOpenIdTokenCreator`）

### prod のマイグレーション前のバックアップ

- 新しいマイグレーションがあるときだけ、cd-prod で `gcloud sql backups create` を実行してから migrate Job を動かす。deployer-prod に `roles/cloudsql.editor` 相当のバックアップ作成権限を付ける

### GCP のリソース配置

```
<prod-project>                                   <dev-project>
├─ Artifact Registry: mbta-live (イメージは1つ)   │
│    └─ dev の Cloud Run サービスエージェントに reader を付与 ──▶ 同じイメージを pull
├─ GCS: Terraform state (prod)                  ├─ GCS: Terraform state (dev)
├─ WIF pool/provider (GitHub)                   ├─ WIF pool/provider (GitHub)
├─ SA: ci-builder（イメージの push だけ）          │
├─ SA: deployer-prod, smoke-tester              ├─ SA: deployer-dev, smoke-tester
└─ アプリ一式                                     └─ アプリ一式
   Cloud Run (web + Jobs), Cloud SQL, Scheduler,    （同じ構成）
   Secret Manager (DB パスワード, MBTA_API_KEY), IAP
```

## 憲章との適合確認（Constitution Check）

| 原則 | 適合 |
|---|---|
| VI. 1 つのイメージ | ✅ CI で 1 回ビルドし、同じダイジェストを dev → prod |
| VII. 後方互換のマイグレーション | ✅ ロールバックはイメージの差し替えだけ |
| 公開リポジトリ | ✅ 秘密の値は Environment の secrets と Secret Manager。plan ファイルを artifact にしない。PR とリリースの両方で秘密の値の混入を検査する |

## プロジェクト構成（Project Structure）

### 文書（この feature）

```text
specs/004-infra-cicd/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── pipeline.md
└── tasks.md             # /speckit-tasks で作成
```

### ソースコード（リポジトリのルートから）

```text
infra/terraform/
├── bootstrap/          # 最初に一度だけ人が apply: GCP プロジェクト（dev / prod）、API の有効化、
│                       # state バケット、Artifact Registry、WIF、SA、
│                       # GitHub の Environment・variables・secrets・ルールセット・セキュリティ設定
├── modules/app/        # Cloud SQL、Secret Manager、Cloud Run（web）、Cloud Run Jobs、
│                       # Cloud Scheduler、IAP、実行用の SA、予算アラート
└── envs/
    ├── dev/            # backend.tf + main.tf（module "app"）+ terraform.tfvars（公開してよい値だけ）
    └── prod/
.github/workflows/
├── pr-checks.yml
├── pipeline.yml
└── rollback.yml
tests/e2e/dev/          # dev の URL に対して実行する読み取りだけの E2E
tests/smoke/            # スモークテスト（dev / prod 共通）
Dockerfile
```

**構成の決定**: パイプラインの前提（GCP プロジェクト、state バケット、WIF、SA、Artifact Registry、GitHub の Environment と variables・secrets、main のルールセット）は `bootstrap/` に分け、人が一度だけ apply する（ご自身の Google アカウントと、GitHub のトークンの権限で）。それ以外はパイプラインが apply する。人の手作業は、請求先アカウントとプロジェクト ID を決めること、MBTA API キーの取得と Secret Manager への登録、bootstrap の apply だけにする

## 複雑さの記録（Complexity Tracking）

| 原則からの逸脱 | 必要な理由 | より単純な案を採らなかった理由 |
|---|---|---|
| prod の plan のハッシュ比較 | 承認者が見た変更と違うものを prod に適用しないため | plan ファイルを artifact で渡す方法は、public リポジトリでは秘密の値が漏れうる |
| トラフィック 0% のデプロイとタグ付き URL での確認 | 新しいリビジョンが壊れていても利用者に影響させないため | 直接 100% にすると、スモークテストで失敗を見つけた時点で利用者が影響を受けている |
