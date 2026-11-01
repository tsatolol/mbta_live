# CLAUDE.md — mbta_live

このファイルは本リポジトリの**仕様書兼開発ガイド**です。Claude Code はコードを書く前にこのファイルを読み、ここに書かれた決定事項に従ってください。決定を変更する場合は、先にこのファイルを更新してから実装します。

---

## 1. プロジェクト概要

MBTA V3 API を使い、ボストン地下鉄（Rapid Transit）の運行状況を**リアルタイム監視**し、収集データを蓄積して**運行品質を分析**するダッシュボード。

- **用途**: 運行監視・分析（定時性・運行間隔・予測精度・アラート傾向の把握）
- **利用者**: 自分および許可した特定ユーザーのみ（IAP で制限）
- **UI 言語**: 英語（コード内コメント・ドキュメントは日本語可）
- **表示タイムゾーン**: ボストン時間 `America/New_York`（DB は UTC で保存）

### 決定事項サマリ

| 項目 | 決定 |
|---|---|
| 対象路線 | Rapid Transit 全線: `Red`, `Mattapan`, `Orange`, `Blue`, `Green-B`, `Green-C`, `Green-D`, `Green-E` |
| 機能 | 車両位置マップ / 駅別到着予測 / 運行アラート / 履歴・統計グラフ |
| 技術スタック | Next.js (App Router, TypeScript) 一体型、Cloud Run 1 サービス + Cloud Run Jobs |
| DB | Cloud SQL for PostgreSQL 16 + Drizzle ORM (drizzle-kit でマイグレーション) |
| データ収集 | Cloud Scheduler → Cloud Run Job による **1 分間隔ポーリング** |
| データ保持 | 生データ **90 日**、日次集計は**無期限** |
| MBTA API キー | **当面なし**（20 req/分 制限）。環境変数で後から追加可能な設計 |
| 画面更新 | ブラウザ → 自前 API を 15〜30 秒間隔でポーリング（DB の最新スナップショットを返す） |
| 地図 | MapLibre GL JS + OpenFreeMap（OSM ベース、API キー不要） |
| 認証 | IAP（Identity-Aware Proxy）で許可ユーザーのみ |
| GCP | `us-east4`、最小構成（コスト優先） |
| IaC / CI/CD | Terraform + GitHub Actions（Workload Identity Federation） |
| テスト | Vitest（単体）+ Playwright（E2E）、MBTA API はフィクスチャでモック |

---

## 2. アーキテクチャ

```
                         ┌──────────────────────── GCP (us-east4) ────────────────────────┐
                         │                                                                │
 MBTA V3 API  ◀──GET──── │  Cloud Run Job: collector     ◀── Cloud Scheduler (毎分)        │
 api-v3.mbta.com         │  Cloud Run Job: sync-static   ◀── Cloud Scheduler (毎日 04:00 ET)│
                         │  Cloud Run Job: aggregate     ◀── Cloud Scheduler (毎日 04:30 ET)│
                         │  Cloud Run Job: migrate       ◀── GitHub Actions (デプロイ時)    │
                         │            │                                                   │
                         │            ▼                                                   │
                         │   Cloud SQL (PostgreSQL 16)                                    │
                         │            ▲                                                   │
                         │            │ (読み取りのみ)                                     │
 ブラウザ ──HTTPS──▶ IAP ─┼─▶ Cloud Run Service: web (Next.js: UI + Route Handlers)        │
                         │                                                                │
                         │   Secret Manager: DB パスワード, (将来) MBTA_API_KEY              │
                         └────────────────────────────────────────────────────────────────┘
```

### 重要な設計ルール

1. **MBTA API を呼ぶのは Jobs（collector / sync-static）だけ。** web サービスとブラウザは MBTA API を直接呼ばない。web は DB だけを読む。
   - 理由: API キーなしの上限は **20 req/分（送信元 IP 単位）**。閲覧者数に関係なく API 使用量を一定に保つため。
2. **web は読み取り専用。** DB への書き込みは Jobs だけが行う。
3. **コードベースとコンテナイメージは 1 つ。** web と各 Job は同じイメージを使い、起動コマンドだけを変える。
4. ドメインロジック（到着検出、運行間隔、予測誤差の計算）は `src/lib/metrics/` に**副作用のない純粋関数**として置き、単体テストする。

---

## 3. MBTA V3 API の利用方針

- Base URL: `https://api-v3.mbta.com`（環境変数 `MBTA_API_BASE_URL` で上書き可）
- 形式: JSON:API（`data[].attributes`, `data[].relationships`, `included`）
- 認証: キーなし。`MBTA_API_KEY` が設定されていれば `x-api-key` ヘッダーで送る（キーありの上限は 1000 req/分）
- レート制限ヘッダー `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset` をログに残し、`collector_runs` に保存する（ヘッダー名は実装時に要確認）
- `fields[...]`（sparse fieldsets）で必要な属性だけを取得し、レスポンスを小さくする
- レスポンスは **必ず zod でパースして検証**する。スキーマに合わない行はスキップしてログに残し、ジョブ全体は落とさない

### 使用エンドポイント

| ジョブ | エンドポイント | 頻度 | 主なパラメータ |
|---|---|---|---|
| collector | `GET /vehicles` | 毎分 | `filter[route]=Red,Mattapan,Orange,Blue,Green-B,Green-C,Green-D,Green-E` |
| collector | `GET /predictions` | 毎分 | `filter[route]=<同上>`（predictions は stop/route/trip/位置のいずれかでのフィルタが必須） |
| collector | `GET /alerts` | 毎分 | `filter[route]=<同上>`（または `filter[route_type]=0,1`） |
| sync-static | `GET /routes` | 毎日 | `filter[type]=0,1` |
| sync-static | `GET /stops` | 毎日 | `filter[route_type]=0,1`、`include=parent_station`（ホーム→親駅の対応を保存）※取得範囲は要確認 |
| sync-static | `GET /route_patterns` | 毎日 | `filter[route]=...`、`include=representative_trip.shape`（地図用の路線形状と停車順） |

- route_type: `0` = Light Rail（Green 各支線, Mattapan）、`1` = Heavy Rail（Red, Orange, Blue）
- 予算: collector は **1 回あたり 3 リクエスト**、sync-static は 1 日あたり十数リクエスト。合計で常に **5 req/分以下** に収める
- ローカル開発も同じ IP 制限を共有する。開発中は `MBTA_FIXTURE_MODE=1` で `tests/fixtures/mbta/` のフィクスチャを使い、実 API は `pnpm job:collect` を手動で数回実行する程度にとどめる
- 429 を受けたら、その回はリトライせずに終了する（次の分の実行に任せる）
- 画面のフッターに出典表記 `Data provided by MBTA` と地図タイルの帰属表示（OpenFreeMap / © OpenStreetMap contributors）を必ず出す

### ID の扱い

- 予測と車両の `stop` は**ホーム（child stop, 例: `70061`）**を指す。分析と UI では**親駅（`place-xxxx`）**に寄せて集計する（`stops.parent_station_id` で対応づける）
- Green Line の幹線区間（Kenmore〜Government Center など、支線が共有する駅）での運行間隔は、支線別に加えて**全支線合算（`Green`）**でも計算する
- 運行日（service date）: MBTA の運行日は日付をまたぐため、`America/New_York` の時刻から **3 時間引いた日付**を運行日とする（`src/lib/time.ts` に一元化）

---

## 4. データモデル（Drizzle / PostgreSQL）

時刻はすべて `timestamptz`（UTC）で保存する。テーブル名は snake_case。

### 4.1 静的データ（sync-static が毎日 upsert）

- `routes` — `id` PK, `short_name`, `long_name`, `type`, `color`, `text_color`, `direction_names` jsonb, `direction_destinations` jsonb, `sort_order`
- `stops` — `id` PK, `name`, `lat`, `lon`, `location_type`, `parent_station_id`, `platform_name`
- `route_patterns` — `id` PK, `route_id`, `direction_id`, `typicality`, `shape_polyline`（encoded polyline）, `stop_ids` jsonb（停車順の親駅 ID）

路線の色は API の `routes.color` を使い、コードに直接書かない。

### 4.2 現在値テーブル（collector が毎分、トランザクション内で入れ替え）

- `vehicles_current` — `vehicle_id` PK, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`（`INCOMING_AT` / `STOPPED_AT` / `IN_TRANSIT_TO`）, `stop_id`, `current_stop_sequence`, `label`, `occupancy_status`, `updated_at`, `polled_at`
- `predictions_current` — `id` PK, `route_id`, `trip_id`, `stop_id`, `direction_id`, `stop_sequence`, `arrival_time`, `departure_time`, `status`, `schedule_relationship`, `vehicle_id`, `polled_at`
- `alerts` — `id` PK, `effect`, `cause`, `severity`, `header`, `description`, `lifecycle`, `active_period` jsonb, `informed_entity` jsonb, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `is_active`
  - アラートは削除せず upsert。フィードから消えたら `is_active=false` にする
- `alert_routes` — (`alert_id`, `route_id`) PK（路線別集計用）

### 4.3 履歴テーブル（生データ。90 日で削除）

日単位のパーティション（PostgreSQL の宣言的パーティショニング）にして、保持期間の削除はパーティションごと `DROP` する。Drizzle はパーティションを扱えないので、`drizzle/` 配下に手書き SQL のマイグレーションとして作る。

- `vehicle_positions` — `vehicle_id`, `updated_at`, `polled_at`, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`, `stop_id`, `current_stop_sequence`。PK (`vehicle_id`, `updated_at`)。`updated_at` が前回と同じ車両は保存しない
- `prediction_samples` — `service_date`, `trip_id`, `stop_id`, `lead_bucket_min`, `route_id`, `direction_id`, `predicted_arrival_at`, `observed_at`。PK (`service_date`, `trip_id`, `stop_id`, `lead_bucket_min`)
  - 全予測を毎分保存すると 90 日で数億行になるので、**リード時間バケット `[1, 3, 5, 10, 15]` 分ごとに 1 件だけ**保存する（§5.2）
- `arrival_events` — `service_date`, `trip_id`, `stop_id`（親駅）, `route_id`, `direction_id`, `vehicle_id`, `arrived_at`, `source`（`stopped_at` / `predicted_last` / `interpolated`）, `precision_sec`。PK (`service_date`, `trip_id`, `stop_id`)
- `collector_runs` — `id`, `job`, `started_at`, `finished_at`, `status`, `counts` jsonb, `ratelimit_remaining`, `error`

### 4.4 集計テーブル（aggregate が毎日作成。無期限保持）

- `daily_headway_stats` — `service_date`, `route_id`（`Green` 合算を含む）, `direction_id`, `stop_id`, `hour`（0–23, ET）, `n`, `mean_sec`, `p50_sec`, `p90_sec`, `max_sec`, `bunching_count`, `gap_count`
- `daily_prediction_accuracy` — `service_date`, `route_id`, `direction_id`, `lead_bucket_min`, `hour`, `n`, `mean_error_sec`, `mean_abs_error_sec`, `p90_abs_error_sec`, `within_60s_ratio`
- `daily_alert_stats` — `service_date`, `route_id`, `effect`, `cause`, `alert_count`, `active_minutes`

曜日 × 時間帯のヒートマップは、これらのテーブルの `service_date` の曜日と `hour` から作る。

### データ量の目安

- `vehicle_positions`: 約 150 両 × 1,440 回/日 ≒ 20 万行/日 → 90 日で約 2,000 万行
- `prediction_samples`: 到着イベント約 4 万件/日 × 5 バケット ≒ 20 万行/日
- 最小構成の Cloud SQL（10GB）に収まる見込み。容量は `collector_runs` と Cloud Monitoring で監視する

---

## 5. 分析指標の定義

指標の定数（しきい値やバケット）は `src/lib/metrics/constants.ts` に集めて調整できるようにする。

### 5.1 実到着の検出（`arrival_events`）

collector は毎回、前回の `vehicles_current` と今回の取得結果を比べて到着を検出する。

1. 車両が `STOPPED_AT` で駅 S にいて、(trip, S) のイベントがまだない → `arrived_at = vehicle.updated_at`, `source = stopped_at`
2. `current_stop_sequence` が k から m（m > k）に進み、途中の駅にイベントがない → 前回の `predictions_current` にあるその (trip, 駅) の `arrival_time` を使う。`source = predicted_last`
3. 前回の予測もない → 前後の観測時刻から線形補間する。`source = interpolated`

> **既知の制約**: 1 分間隔のポーリングでは停車時間（30〜60 秒）の短い停車を取りこぼすため、到着時刻の精度は **±60 秒程度**。UI の分析画面にこの注記を出す。改善策（API キーを取得して 30 秒間隔にする）は §11 を参照。

### 5.2 予測誤差（Prediction Accuracy）

- 各回の予測について、リード時間 `lead = predicted_arrival - observed_at` を計算する。`lead` 以上で最小のバケット b ∈ `[1, 3, 5, 10, 15]` 分に `INSERT ... ON CONFLICT DO NOTHING` で保存する（各バケットで最初の観測を残す）
- `error_sec = actual_arrival - predicted_arrival`（**正の値 = 予測より遅く到着**）
- 実到着は `arrival_events` と (service_date, trip_id, 親駅) で突き合わせる。`source = interpolated` のイベントは精度集計から除く
- 指標: 平均誤差（バイアス）、平均絶対誤差、p90 絶対誤差、±60 秒以内の割合

### 5.3 運行間隔（Headway）

- (route, direction, 親駅) ごとに `arrived_at` を並べ、連続する到着の差を運行間隔とする
- 60 分を超える間隔は運休時間帯とみなして除外する
- **団子運転（bunching）**: 間隔 < 2 分
- **間隔の開き（gap）**: 間隔 > 同じ (route, direction, 駅, 曜日種別, hour) の過去 28 日の中央値 × 2

### 5.4 アラート

- 件数: (運行日, route, effect, cause) ごとに、その日に有効だったアラートの数
- 継続時間: `first_seen_at`〜`last_seen_at`（または `active_period`）のうち、その日に重なる分数
- effect の例: `DELAY`, `SHUTTLE`, `SUSPENSION`, `STATION_CLOSURE`, `DETOUR` など。値の一覧は実データで要確認。未知の値はそのまま保存する

---

## 6. 画面仕様（UI は英語）

共通: ヘッダーに `Last updated: hh:mm:ss ET` を表示する。collector の最終成功から 3 分以上経ったら警告バナー `Live data is stale` を出す。

| パス | 画面 | 内容 |
|---|---|---|
| `/` | **Live Map** | MapLibre で路線形状を路線色で描き、車両を進行方向（bearing）に回転させた矢印で表示。路線フィルタのトグル。車両をクリックするとポップアップ（路線、行先、次の駅、状態、何秒前の情報か）。15 秒ごとに更新 |
| `/stations` | **Stations** | 駅の一覧と検索（路線別にまとめる） |
| `/stations/[stopId]` | **Arrival Board** | 方向別に次の列車 3 本の `n min` 表示。到着予定時刻からブラウザ側でカウントダウンし、30 秒ごとに更新。その駅に関係するアラートも表示 |
| `/alerts` | **Alerts** | 有効なアラートを路線別・重要度順に表示（effect バッジ付き）。過去のアラートの検索 |
| `/analytics/headways` | **Headways** | route / direction / station / 期間で絞り込み。運行間隔の推移グラフ、分布、bunching・gap の件数 |
| `/analytics/predictions` | **Prediction Accuracy** | リード時間バケット別の誤差の分布、時系列、路線比較 |
| `/analytics/alerts` | **Alert Trends** | 路線別・effect 別・cause 別の件数と継続時間の推移 |
| `/analytics/patterns` | **Patterns** | 曜日 × 時間帯のヒートマップ（運行間隔 p90、予測誤差、アラートの分数を切り替え） |
| `/status` | **System Status** | `collector_runs` の直近の結果、レート制限の残量、DB のデータ量 |

- UI: Tailwind CSS + shadcn/ui
- データ取得: TanStack Query（`refetchInterval` でポーリング）
- グラフ: Apache ECharts（ヒートマップと大量の時系列を扱いやすいため）
- 地図スタイル: OpenFreeMap `positron`（路線色を目立たせるため淡色）

---

## 7. 内部 API（Next.js Route Handlers）

すべて GET、読み取り専用。クエリパラメータは zod で検証し、エラーは `400 { error }` で返す。

| パス | 返す内容 |
|---|---|
| `/api/live/vehicles?routes=` | `vehicles_current` + 最終更新時刻 |
| `/api/live/predictions?stop=` | 親駅に属するホームの `predictions_current`（方向別） |
| `/api/live/alerts?routes=&active=` | アラート一覧 |
| `/api/static/routes` | 路線と形状（GeoJSON に変換済み） |
| `/api/static/stops?route=` | 親駅の一覧 |
| `/api/analytics/headways?route=&direction=&stop=&from=&to=` | 集計テーブルから。当日分は `arrival_events` から計算 |
| `/api/analytics/predictions?route=&direction=&from=&to=` | 同上 |
| `/api/analytics/alerts?route=&from=&to=` | 同上 |
| `/api/analytics/heatmap?metric=&route=&from=&to=` | 曜日 × 時間帯の行列 |
| `/api/health` | DB 接続と collector の最終成功時刻（Cloud Run のヘルスチェック用） |

---

## 8. ディレクトリ構成

```
.
├── CLAUDE.md
├── README.md
├── Dockerfile               # web と jobs 共通のイメージ（Next.js standalone + 各 Job のバンドル）
├── docker-compose.yml       # ローカル用 PostgreSQL 16
├── drizzle.config.ts
├── drizzle/                 # マイグレーション（生成分 + パーティション用の手書き SQL）
├── src/
│   ├── app/                 # App Router のページと api/ 配下の Route Handlers
│   ├── components/          # UI コンポーネント（map/, charts/, ui/）
│   ├── lib/
│   │   ├── mbta/            # API クライアント、zod スキーマ、JSON:API → ドメイン型への変換（server-only）
│   │   ├── db/              # Drizzle のスキーマ・クライアント・クエリ
│   │   ├── metrics/         # 到着検出・運行間隔・予測誤差（純粋関数）+ constants.ts
│   │   └── time.ts          # 運行日の計算、タイムゾーン変換
│   └── jobs/
│       ├── collect.ts       # 毎分
│       ├── sync-static.ts   # 毎日
│       ├── aggregate.ts     # 毎日: 集計 + パーティションの作成と削除
│       └── migrate.ts       # デプロイ時
├── tests/
│   ├── unit/
│   ├── e2e/
│   └── fixtures/mbta/       # 実 API から記録した JSON
├── infra/terraform/
└── .github/workflows/
```

---

## 9. 開発コマンド（予定）

パッケージマネージャは **pnpm**、Node.js は Active LTS（24.x）。

```bash
docker compose up -d db        # ローカル PostgreSQL を起動
pnpm install
pnpm db:migrate                # マイグレーションを適用
pnpm job:sync-static           # 静的データを取得（実 API）
pnpm job:collect               # collector を 1 回実行（実 API。連打しない）
pnpm dev                       # http://localhost:3000

pnpm lint && pnpm typecheck    # コミット前に必ず実行
pnpm test                      # Vitest
pnpm test:e2e                  # Playwright（シード済み DB + フィクスチャ）
pnpm db:generate               # スキーマ変更後にマイグレーションを生成
pnpm fixtures:record           # 実 API からフィクスチャを記録（数リクエスト）
```

### 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | ローカル用の接続文字列 |
| `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Cloud Run 用（Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>` で接続。パスワードは Secret Manager から注入） |
| `MBTA_API_BASE_URL` | 既定値 `https://api-v3.mbta.com` |
| `MBTA_API_KEY` | 任意。設定すると `x-api-key` ヘッダーで送る |
| `MBTA_FIXTURE_MODE` | `1` で MBTA API の代わりにフィクスチャを使う |

`.env.local` はコミットしない。`.env.example` を用意して最新に保つ。

---

## 10. インフラと CI/CD

### Terraform（`infra/terraform/`）

- state は GCS バケットに置く（バケットは初回だけ手動で作る）
- 管理するリソース: API の有効化、Artifact Registry、Cloud SQL（PostgreSQL 16, Enterprise, `db-f1-micro`, 10GB, 自動バックアップ 7 日）、DB とユーザー、Secret Manager、サービスアカウント（web / jobs / scheduler / deployer）、Cloud Run サービス（web）、Cloud Run Jobs（collector / sync-static / aggregate / migrate）、Cloud Scheduler、Workload Identity Federation（GitHub 用）、IAP、予算アラート
- web の Cloud Run は `min-instances=0`。IAP は Cloud Run に直接組み込む方式（`--iap`）を使う。使えない場合は外部 HTTPS LB + Serverless NEG + IAP にする
- IAP で許可するユーザーのメールアドレスは `terraform.tfvars` で渡し、**コミットしない**（`*.tfvars` は gitignore。`terraform.tfvars.example` だけをコミットする）
- イメージのタグは GitHub Actions が更新するので、Terraform 側では `lifecycle { ignore_changes = [image] }` にする
- collector Job: タスクのタイムアウト 50 秒、リトライ 0。実行が重なったときは `pg_try_advisory_lock` で後の実行を即終了させる
- Cloud Scheduler の時刻は `America/New_York` で指定する

### GitHub Actions（`.github/workflows/`）

- `ci.yml`（PR と push）: pnpm install → lint → typecheck → vitest → Playwright（Postgres のサービスコンテナ + フィクスチャ）→ `terraform fmt -check` / `validate`
- `deploy.yml`（main への push）: WIF で認証 → イメージをビルドして Artifact Registry に push → `migrate` Job を実行 → web をデプロイ → 各 Job のイメージを更新
- `terraform.yml`: `infra/**` を変更した PR では `plan` の結果をコメントする。`apply` は `workflow_dispatch` で手動実行する
- サービスアカウントのキー（JSON）は使わない。WIF のみ

---

## 11. 実装フェーズ

分析には履歴データが必要なので、**collector をできるだけ早く本番で動かし始める**。

1. **Phase 0 — 土台**: Next.js の雛形、docker-compose、Drizzle のスキーマ、MBTA クライアント + zod スキーマ、フィクスチャの記録
2. **Phase 1 — 収集**: `sync-static` と `collect`（現在値テーブル、履歴テーブル、到着検出）。ローカルで動作確認する
3. **Phase 2 — 本番の基盤**: Terraform、CI/CD、IAP。collector を本番で動かしてデータの蓄積を始める
4. **Phase 3 — リアルタイム画面**: Live Map、Stations / Arrival Board、Alerts、Status
5. **Phase 4 — 分析**: `aggregate` Job、保持期間の処理、分析画面 4 つ
6. **Phase 5 — 改善（任意）**: 時刻表（`/schedules`）との比較による遅延指標、API キーを取得して 30 秒間隔の収集にする（到着検出の精度向上）、アラート通知

---

## 12. コーディング規約

- TypeScript は `strict`。`any` は禁止（外部入力は `unknown` で受けて zod でパースする）
- `src/lib/mbta/` と `src/lib/db/` は `import "server-only"` を付け、クライアントのバンドルに入らないようにする
- 日時は DB とサーバーでは UTC の `Date` で扱い、表示するときだけ `America/New_York` に変換する（`date-fns` + `@date-fns/tz`）。運行日の計算は `src/lib/time.ts` だけで行う
- 路線 ID の一覧などの定数は `src/lib/mbta/constants.ts` に一元化する
- 分析ロジックは純粋関数で書き、必ず Vitest のテストを付ける（日付またぎ、Green 幹線の合算、取りこぼしの補間などの境界ケースを含める）
- 新しく MBTA API のエンドポイントを使うときは、§3 のリクエスト予算（5 req/分以下）に収まるかを確認し、この表を更新する
- コミットメッセージは英語、Conventional Commits（`feat:`, `fix:`, `chore:` …）

---

## 13. 未決事項・要確認

- [ ] GCP プロジェクト ID、予算アラートの金額
- [ ] 独自ドメインを使うか（使わない場合は Cloud Run の URL）
- [ ] 実 API で確認すること: `/stops` で親駅とホームの両方を取得できるフィルタの組み合わせ、`/predictions` の `filter[route]` に複数路線を指定したときのレスポンスサイズ、レート制限ヘッダーの名前、alerts の `effect` / `cause` の値の一覧
- [ ] bunching / gap のしきい値（§5.3）を実データを見て調整する
- [ ] 時刻表との比較（Phase 5）をするかどうか
