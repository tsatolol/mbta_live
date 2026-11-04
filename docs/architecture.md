# アーキテクチャ — mbta_live

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
| GCP プロジェクト | `mbta-live-dev-76bt` | `mbta-live-prod-76bt` |
| デプロイ | main への push で自動 | dev 成功後、承認されてから |
| collector の間隔 | 5 分（`*/5 * * * *`） | 1 分（`* * * * *`） |
| sync-static / aggregate | 毎日 04:00 / 04:30 ET | 同左 |
| 生データの保持 | 3 日 | 28 日 |
| Cloud SQL | `db-f1-micro`、バックアップ 1 日、`deletion_protection=false` | `db-f1-micro`、バックアップ 7 日、`deletion_protection=true` |
| 値の置き場所 | `infra/terraform/envs/dev/terraform.tfvars` | `infra/terraform/envs/prod/terraform.tfvars` |
| IAP で許可するユーザー | 開発者 | 利用者（開発者を含む） |
| MBTA API キー | dev 用 | prod 用 |
| 予算アラート | 小さめ | 本番相当（金額は未定。bootstrap の `monthly_budgets`） |
| 監視の通知 | なし（Cloud Monitoring の画面で見る） | メール（bootstrap の通知チャンネル） |

## リポジトリ構成

```text
.
├── CLAUDE.md
├── README.md
├── Dockerfile               # Web とジョブ共通のイメージ（Next.js standalone + 各ジョブのバンドル + Prisma CLI）
├── scripts/                 # フィクスチャの記録、ジョブのバンドル（build-jobs.mjs）、インフラの検査
├── docker-compose.yml       # ローカル用 PostgreSQL 16
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma        # DB スキーマの正（実装後）
│   ├── migrations/          # Prisma Migrate（パーティション部分は手書き SQL）
│   └── sql/                 # TypedSQL（分析・集計クエリ）
├── src/
│   ├── app/                 # App Router のページと api/ 配下の Route Handlers（002, 003）
│   ├── generated/prisma/    # prisma generate の出力（gitignore）
│   ├── components/          # UI コンポーネント（layout/, map/, arrivals/, charts/, ui/）（002, 003）
│   ├── hooks/               # 画面で共有する React のフック（use-now.ts など）
│   ├── lib/
│   │   ├── mbta/            # API クライアント、zod スキーマ、JSON:API → ドメイン型、constants.ts（server-only）
│   │   ├── db/              # Prisma Client の生成と共有、クエリ関数（server-only）
│   │   ├── api/             # 内部 API の中身（DB と時計を受け取る関数。route.ts から呼ぶ）（server-only）
│   │   ├── api-schemas/     # 内部 API の応答の zod スキーマ（サーバーと画面で共有）
│   │   ├── metrics/         # 到着検出・サンプリング・運行間隔・予測誤差・画面で計算する値（純粋関数）+ constants.ts
│   │   ├── clock.ts         # 現在時刻の取得（テストで差し替える）
│   │   └── time.ts          # 運行日の計算、タイムゾーン変換
│   └── jobs/
│       ├── collect.ts       # collector（001）
│       ├── sync-static.ts   # 静的データの同期（001）
│       └── aggregate.ts     # 日次集計 + パーティションの作成と削除（003 / 001）
├── tests/
│   ├── unit/                # 純粋関数（Vitest）
│   ├── integration/         # 本物の PostgreSQL を使うテスト（Vitest）
│   ├── replay/              # 記録した連続ポーリングを collector に流すテスト
│   ├── e2e/                 # Playwright
│   └── fixtures/mbta/       # 実 API から記録した JSON（記録日をファイル名に含める）
├── infra/terraform/         # 004
├── .github/workflows/       # 004
├── docs/                    # システム全体の文書（このファイル、development.md）
├── .specify/                # spec-kit（憲章、テンプレート、スクリプト）
└── specs/                   # spec-kit の feature ごとの文書
```

## 画面と内部 API（002）

web は Next.js の App Router。画面はすべてクライアントで描画し（`"use client"`）、ブラウザから内部 API（Route Handlers）を TanStack Query で定期的に取得する。内部 API は DB を読むだけで、MBTA API は呼ばない。応答の型は `src/lib/api-schemas/` の zod スキーマで、サーバーと画面の両方が使う（契約は `specs/002-live-dashboard/contracts/live-api.md`）。

| 画面 | パス | 使う内部 API | 取得の間隔 |
|---|---|---|---|
| Live Map | `/` | `/api/static/routes`, `/api/live/vehicles` | 車両 15 秒 |
| Stations | `/stations` | `/api/static/stops` | 1 時間（静的データ） |
| Arrival Board | `/stations/[stopId]` | `/api/live/predictions` | 30 秒（カウントダウンは毎秒） |
| Alerts | `/alerts` | `/api/live/alerts`, `/api/static/routes` | 60 秒（過去の検索は送信時） |
| System Status | `/status` | `/api/status` | 30 秒 |
| 共通のヘッダー | すべて | `/api/health`（最終更新時刻と stale バナー） | 30 秒 |

- Route Handler（`src/app/api/**/route.ts`）は、本番の DB と時計を `src/lib/api/` の関数に渡して呼ぶだけ。結合テストはその関数に、テスト用の DB と固定した時計を渡して呼ぶ
- 計算する値（stale、アラートの状態、次の 3 本の選び方など）は `src/lib/metrics/` の純粋関数
- 地図は MapLibre GL JS + OpenFreeMap（positron）。Worker はビルド時に `public/vendor/` にコピーする（`scripts/copy-maplibre-worker.mjs`）
- 時刻は API では UTC の ISO 8601、画面でボストン時間に変換する（`formatInBoston`）
- テスト: E2E（`tests/e2e/`）はフィクスチャを collector で取り込んだ DB に、本番と同じビルドを起動して実行する（リリース用の CI でも実行）。デプロイ後は dev に対して IAP を通した読み取りだけの E2E（`tests/e2e/dev/`）を実行する

## 認証・監視・ロールバック

- **IAP**: Cloud Run に直接組み込む IAP（`iap_enabled`）。プロジェクトが組織に属していないので、OAuth クライアントは Cloud Console で作り、bootstrap が IAP の設定（プロジェクト単位）に入れる。許可するユーザーと smoke-tester は、bootstrap がプロジェクト単位の `roles/iap.httpsResourceAccessor` で付ける（`specs/004-infra-cicd/research.md`）
- **監視**: ジョブの終了ログ（`job`・`status`・`counts` と、collector の `inServiceHours`・`rejectedRowRatio`・`aggregateOverdue`）をログベースの指標にし、Cloud Monitoring のアラートポリシーで見る。web は Cloud Run の指標（5xx の割合、応答時間の p95）。prod はメールで通知し、dev は通知しない（`infra/terraform/modules/app/monitoring.tf`）
- **ロールバック**: `.github/workflows/rollback.yml`。web を `previous` タグのリビジョンに戻すか、指定したイメージに差し替える。Terraform とマイグレーションは実行しない

## イメージの起動コマンド

イメージは 1 つ（`Dockerfile`）。既定のコマンドは web で、Cloud Run Jobs は command / args で上書きする（`infra/terraform/modules/app/jobs.tf`）。作業ディレクトリは `/app`。

| 用途 | コマンド | ローカルで同じ処理 |
|---|---|---|
| web | `node server.js`（既定。`PORT=8080`） | `pnpm dev` / `pnpm start` |
| collector | `node jobs/collect.mjs` | `pnpm job:collect` |
| sync-static | `node jobs/sync-static.mjs` | `pnpm job:sync-static` |
| aggregate | `node jobs/aggregate.mjs` | `pnpm job:aggregate` |
| migrate | `node migrate/node_modules/prisma/build/index.js migrate deploy --config migrate/prisma.config.ts` | `pnpm db:migrate` |

`jobs/*.mjs` は `src/jobs/` を依存ごと 1 ファイルにまとめたもの（`pnpm build:jobs`）。イメージの中身と決めた理由は `specs/004-infra-cicd/research.md` の「イメージの中身」。

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
