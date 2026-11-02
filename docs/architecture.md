# Architecture — mbta_live

システムが**今どうなっているか**をまとめた文書。feature（`specs/NNN-*/`）をまたぐ情報はここにだけ書き、各 feature の `plan.md` からはこのファイルを参照する。feature で構成を変えたら、この文書も更新する。

## システム構成

dev と prod の 2 つの GCP プロジェクトに、それぞれこの構成を作る（`specs/004-infra-cicd/`）。

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

| コンポーネント | 担当する feature |
|---|---|
| collector, sync-static, 生データのテーブル | 001 |
| web（地図・駅・アラート・稼働状況）| 002 |
| aggregate, 集計テーブル, web（分析画面）| 003 |
| GCP 環境, Terraform, パイプライン, 監視 | 004 |

## 環境の違い

| | dev | prod |
|---|---|---|
| GCP プロジェクト | `<dev-project-id>`（未定） | `<prod-project-id>`（未定） |
| デプロイ | main への push で自動 | dev 成功後、承認されてから |
| collector の間隔 | 5 分（`*/5 * * * *`） | 1 分（`* * * * *`） |
| sync-static / aggregate | 毎日 04:00 / 04:30 ET | 同左 |
| 生データの保持 | 3 日 | 28 日 |
| Cloud SQL | `db-f1-micro`、バックアップ 1 日、`deletion_protection=false` | `db-f1-micro`、バックアップ 7 日、`deletion_protection=true` |
| IAP で許可するユーザー | 開発者 | 利用者（開発者を含む） |
| MBTA API キー | dev 用 | prod 用 |
| 予算アラート | 小さめ | 本番相当 |

## リポジトリ構成

```text
.
├── CLAUDE.md
├── README.md
├── Dockerfile               # Web とジョブ共通のイメージ（Next.js standalone + 各ジョブのバンドル + Prisma CLI）
├── docker-compose.yml       # ローカル用 PostgreSQL 16
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma        # DB スキーマの正（実装後）
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
│   │   ├── clock.ts         # 現在時刻の取得（テストで差し替える）
│   │   └── time.ts          # 運行日の計算、タイムゾーン変換
│   └── jobs/
│       ├── collect.ts       # collector（001）
│       ├── sync-static.ts   # 静的データの同期（001）
│       ├── aggregate.ts     # 日次集計 + パーティションの作成と削除（003 / 001）
│       └── migrate.ts       # prisma migrate deploy（004）
├── tests/
│   ├── unit/                # 純粋関数（Vitest）
│   ├── integration/         # 本物の PostgreSQL を使うテスト（Vitest）
│   ├── replay/              # 記録した連続ポーリングを collector に流すテスト
│   ├── e2e/                 # Playwright
│   └── fixtures/mbta/       # 実 API から記録した JSON（記録日をファイル名に含める）
├── infra/terraform/         # 004
├── .github/workflows/       # 004
├── docs/                    # システム全体の文書（このファイル、development.md）
├── .specify/                # spec-kit（constitution、テンプレート、スクリプト）
└── specs/                   # spec-kit の feature ごとの文書
```

Web とジョブは同じ Next.js プロジェクト・同じイメージに入れる。MBTA と DB にアクセスするコードは `src/lib/mbta/`・`src/lib/db/` にまとめ、`import "server-only"` でクライアントのバンドルに入らないようにする。

## 文書の正（source of truth）

| 情報 | 正 |
|---|---|
| プロジェクトの原則 | `.specify/memory/constitution.md` |
| システムの現在の構成 | このファイル |
| DB スキーマ | 実装前は各 feature の `data-model.md`、実装後は `prisma/schema.prisma`。`data-model.md` は「その feature で何を足したか・なぜか」の記録として残す |
| MBTA API の使い方と実測した性質 | `specs/001-data-collection/contracts/mbta-api.md` |
| 内部 API | `specs/002-live-dashboard/contracts/live-api.md`, `specs/003-analytics/contracts/analytics-api.md` |
| 開発手順・環境変数 | `docs/development.md` |
