# Implementation Plan: インフラと CI/CD

**Branch**: `004-infra-cicd` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-infra-cicd/spec.md`

## Summary

Terraform で dev / prod の 2 つの GCP プロジェクトにアプリ一式を作り、GitHub Actions の 1 本のパイプラインで、main への push ごとに CI を 1 回、CD を dev（自動）→ prod（承認後）の 2 回実行する。

## Technical Context

**Language/Version**: Terraform（HCL）、GitHub Actions（YAML）、Dockerfile

**Primary Dependencies**: Google provider、google-github-actions/auth（WIF）、gcloud

**Storage**: Terraform state は各環境のプロジェクトの GCS バケット

**Testing**: `terraform fmt -check` / `validate` / `plan`、dev へのデプロイ後のスモークテスト（collector を 1 回実行）

**Target Platform**: Google Cloud（`us-east4`）: Cloud Run（サービス + Jobs）、Cloud SQL（PostgreSQL 16）、Cloud Scheduler、Secret Manager、Artifact Registry、IAP

**Project Type**: インフラ / CI/CD

**Constraints**: 最小構成。public リポジトリなので秘密の値をログ・artifact・tfvars に置かない

**Scale/Scope**: 2 環境 × アプリ一式

### 環境の違い

| | dev | prod |
|---|---|---|
| GCP プロジェクト | `<dev-project-id>`（未定） | `<prod-project-id>`（未定） |
| デプロイ | main への push で自動 | dev 成功後、承認されてから |
| collector の間隔 | 5 分（`*/5 * * * *`） | 1 分（`* * * * *`） |
| 生データの保持 | 3 日 | 28 日 |
| Cloud SQL | `db-f1-micro`、バックアップ 1 日、`deletion_protection=false` | `db-f1-micro`、バックアップ 7 日、`deletion_protection=true` |
| IAP で許可するユーザー | 開発者 | 利用者（開発者を含む） |
| MBTA API キー | dev 用 | prod 用 |
| 予算アラート | 小さめ | 本番相当 |

### スケジュール（Cloud Scheduler、`America/New_York`）

| ジョブ | dev | prod |
|---|---|---|
| collector | `*/5 * * * *` | `* * * * *` |
| sync-static | 毎日 04:00 | 毎日 04:00 |
| aggregate | 毎日 04:30 | 毎日 04:30 |

- collector: タスクのタイムアウト 50 秒、リトライ 0。重なった実行は `pg_try_advisory_lock` で後の実行がすぐ終了する
- web: `min-instances=0`
- イメージはパイプラインが更新するので、Terraform では `lifecycle { ignore_changes = [image] }`

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
