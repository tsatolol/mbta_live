# Implementation Plan: インフラと CI/CD

**Branch**: `004-infra-cicd` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-infra-cicd/spec.md`

## Summary

Terraform で dev / prod の 2 つの GCP プロジェクトにアプリ一式を作り、GitHub Actions の 1 本のパイプラインで、main への push ごとに CI を 1 回、CD を dev（自動）→ prod（承認後）の 2 回実行する。

## Technical Context

**Language/Version**: Terraform（HCL）、GitHub Actions（YAML）、Dockerfile

**Primary Dependencies**: Google provider、google-github-actions/auth（WIF）、gcloud

**Storage**: Terraform state は各環境のプロジェクトの GCS バケット

**Testing**: `terraform fmt -check` / `validate` / `plan`、デプロイ後のスモークテスト（collector を 1 回実行）、マイグレーションの互換性テスト。要件は spec.md の Testing Requirements

**Target Platform**: Google Cloud（`us-east4`）: Cloud Run（サービス + Jobs）、Cloud SQL（PostgreSQL 16）、Cloud Scheduler、Secret Manager、Artifact Registry、IAP

**Project Type**: インフラ / CI/CD

**Constraints**: 最小構成。public リポジトリなので秘密の値をログ・artifact・tfvars に置かない

**Scale/Scope**: 2 環境 × アプリ一式

### 環境の違い

dev と prod の違い（間隔、保持期間、Cloud SQL の設定など）は [docs/architecture.md](../../docs/architecture.md#環境の違い) を参照。値は `envs/<env>/terraform.tfvars` で表す。

### ジョブの設定

スケジュールは Cloud Scheduler の `America/New_York` で指定する（時刻は docs/architecture.md）。

- collector: タスクのタイムアウト 50 秒、リトライ 0。重なった実行は `pg_try_advisory_lock` で後の実行がすぐ終了する
- web: `min-instances=0`
- イメージはパイプラインが更新するので、Terraform では `lifecycle { ignore_changes = [image] }`

### データ品質の監視（FR-013）

- ジョブは件数・解析失敗の行数・未解決の駅 ID の数を構造化ログに出す。Cloud Logging のログベースの指標にし、Cloud Monitoring のアラートポリシーで通知する（通知先はメール）
- 最後の収集成功からの経過時間と前日分の集計の完了は、`/api/health` を Cloud Monitoring の稼働時間チェックで見る（IAP の背後にあるので、監視用 SA に IAP のアクセス権を付ける。方式は実装時に検証する）
- dev では通知せず、ダッシュボードで見るだけにする

### GCP のリソース配置

```
<prod-project>                                   <dev-project>
├─ Artifact Registry: mbta-live (イメージは1つ)   │
│    └─ dev の Cloud Run サービスエージェントに reader を付与 ──▶ 同じイメージを pull
├─ GCS: Terraform state (prod)                  ├─ GCS: Terraform state (dev)
├─ WIF pool/provider (GitHub)                   ├─ WIF pool/provider (GitHub)
├─ SA: ci-builder（イメージの push だけ）          │
├─ SA: deployer-prod                            ├─ SA: deployer-dev
└─ アプリ一式                                     └─ アプリ一式
   Cloud Run (web + Jobs), Cloud SQL, Scheduler,    （同じ構成）
   Secret Manager (DB パスワード, MBTA_API_KEY), IAP
```

## Constitution Check

| 原則 | 適合 |
|---|---|
| VI. 1 つのイメージ | ✅ CI で 1 回ビルドし、同じダイジェストを dev → prod |
| VII. 後方互換のマイグレーション | ✅ ロールバックはイメージの差し替えだけ |
| 公開リポジトリ | ✅ 秘密の値は Environment の secrets と Secret Manager。plan ファイルを artifact にしない |

## Project Structure

### Documentation (this feature)

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

### Source Code (repository root)

```text
infra/terraform/
├── bootstrap/          # 最初に一度だけ手動で apply: API の有効化、state バケット、
│                       # Artifact Registry、WIF、deployer / ci-builder の SA
├── modules/app/        # Cloud SQL、Secret Manager、Cloud Run（web）、Cloud Run Jobs、
│                       # Cloud Scheduler、IAP、実行用の SA、予算アラート
└── envs/
    ├── dev/            # backend.tf + main.tf（module "app"）+ terraform.tfvars（公開してよい値だけ）
    └── prod/
.github/workflows/
├── pipeline.yml
└── rollback.yml
Dockerfile
```

**Structure Decision**: パイプラインの前提（state バケット、WIF、SA、Artifact Registry）は `bootstrap/` に分け、人が一度だけ apply する。それ以外はパイプラインが apply する。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| prod の plan のハッシュ比較 | 承認者が見た変更と違うものを prod に適用しないため | plan ファイルを artifact で渡す方法は、public リポジトリでは秘密の値が漏れうる |
