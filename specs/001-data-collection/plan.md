# Implementation Plan: データ収集（Data Collection）

**Branch**: `001-data-collection` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-data-collection/spec.md`

## Summary

MBTA V3 API から対象 8 路線の車両・予測・アラートを定期的に取得する collector ジョブと、路線・駅・路線パターンを毎日同期する sync-static ジョブを作る。取得のたびに現在値を入れ替え、実到着の推定と予測のサンプリングを行って履歴に残す。生データは日ごとのパーティションに入れ、保持期間を過ぎたら削除する。

### システム全体の構成

001〜004 に共通する構成。dev と prod の 2 つの GCP プロジェクトに、それぞれこの構成を作る（`specs/004-infra-cicd/`）。

```
                         ┌──────────────────────── GCP (us-east4) ─────────────────────────┐
                         │                                                                 │
 MBTA V3 API  ◀──GET──── │  Cloud Run Job: collector     ◀── Cloud Scheduler (毎分/dev 5分)  │
 api-v3.mbta.com         │  Cloud Run Job: sync-static   ◀── Cloud Scheduler (毎日 04:00 ET) │
                         │  Cloud Run Job: aggregate     ◀── Cloud Scheduler (毎日 04:30 ET) │
                         │  Cloud Run Job: migrate       ◀── GitHub Actions (デプロイ時)     │
                         │            │                                                    │
                         │            ▼                                                    │
                         │   Cloud SQL (PostgreSQL 16)                                     │
                         │            ▲                                                    │
                         │            │ (読み取りのみ)                                      │
 ブラウザ ──HTTPS──▶ IAP ─┼─▶ Cloud Run Service: web (Next.js: UI + Route Handlers)         │
                         │                                                                 │
                         │   Secret Manager: DB パスワード, MBTA_API_KEY                     │
                         └─────────────────────────────────────────────────────────────────┘
```

## Technical Context

**Language/Version**: TypeScript（strict）、Node.js Active LTS（24.x）

**Primary Dependencies**: Prisma ORM（`@prisma/adapter-pg` + `pg`）、zod、date-fns + @date-fns/tz

**Storage**: PostgreSQL 16（Cloud SQL）。履歴テーブルは宣言的パーティショニング

**Testing**: Vitest（単体。MBTA API は `tests/fixtures/mbta/` のフィクスチャ）

**Target Platform**: Cloud Run Jobs（`us-east4`）。起動は Cloud Scheduler（`America/New_York`）

**Project Type**: Web アプリ（Next.js）と同じリポジトリ・同じイメージに入るバッチジョブ

**Performance Goals**: 収集 1 回 50 秒未満（Job のタスクタイムアウト 50 秒、リトライ 0）

**Constraints**: MBTA API は 1 環境あたり 5 req/分以下。キーなしの上限は送信元 IP 単位 20 req/分

**Scale/Scope**: 車両 約 150 両、予測 数百〜数千件/回、到着イベント 約 4 万件/日

## Constitution Check

| 原則 | 適合 |
|---|---|
| I. MBTA API はジョブからだけ | ✅ collector / sync-static だけが呼ぶ。予算は contracts/mbta-api.md |
| II. 書き込みはジョブだけ | ✅ |
| III. 入力の検証 | ✅ 応答は zod でパースし、合わない行はスキップ |
| IV. 純粋関数とテスト | ✅ 到着検出・サンプリング・運行日の計算を `src/lib/metrics/`・`src/lib/time.ts` の純粋関数にする |
| V. 時刻の一元化 | ✅ |
| VI. 1 つのイメージ | ✅ Web と同じイメージで、起動コマンドだけを変える |
| VII. 後方互換のマイグレーション | ✅ |

## Project Structure

### Documentation (this feature)

```text
specs/001-data-collection/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── mbta-api.md
└── tasks.md             # /speckit-tasks で作成
```

### Source Code (repository root)

リポジトリ全体の構成。002〜004 もこの構成を前提にする。

```text
.
├── CLAUDE.md
├── README.md
├── Dockerfile               # Web とジョブ共通のイメージ（Next.js standalone + 各ジョブのバンドル + Prisma CLI）
├── docker-compose.yml       # ローカル用 PostgreSQL 16
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/          # Prisma Migrate（パーティション部分は手書き SQL）
│   └── sql/                 # TypedSQL（分析・集計クエリ）
├── src/
│   ├── app/                 # App Router のページと api/ 配下の Route Handlers（002, 003）
│   ├── generated/prisma/    # prisma generate の出力（gitignore）
│   ├── components/          # UI コンポーネント（map/, charts/, ui/）（002, 003）
│   ├── lib/
│   │   ├── mbta/            # API クライアント、zod スキーマ、JSON:API → ドメイン型、constants.ts（server-only）
│   │   ├── db/              # Prisma Client の生成と共有、クエリ関数（server-only）
│   │   ├── metrics/         # 到着検出・サンプリング・運行間隔・予測誤差（純粋関数）+ constants.ts
│   │   └── time.ts          # 運行日の計算、タイムゾーン変換
│   └── jobs/
│       ├── collect.ts       # collector（001）
│       ├── sync-static.ts   # 静的データの同期（001）
│       ├── aggregate.ts     # 日次集計 + パーティションの作成と削除（003 / 001）
│       └── migrate.ts       # prisma migrate deploy（004）
├── tests/
│   ├── unit/
│   ├── e2e/
│   └── fixtures/mbta/       # 実 API から記録した JSON
├── infra/terraform/         # 004
├── .github/workflows/       # 004
├── .specify/                # spec-kit（constitution、テンプレート、スクリプト）
└── specs/                   # spec-kit の feature ごとの文書
```

**Structure Decision**: Next.js 一体型の単一プロジェクト。ジョブは `src/jobs/` に置き、Web と同じイメージにバンドルする。MBTA と DB にアクセスするコードは `src/lib/mbta/`・`src/lib/db/` にまとめ、`import "server-only"` でクライアントのバンドルに入らないようにする。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| パーティションを手書き SQL で管理 | 28 日分の生データを速く・肥大化させずに削除するため | `DELETE` は遅く、テーブルが肥大化する。Prisma のスキーマでは表現できない |
