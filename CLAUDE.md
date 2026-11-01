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
| データ収集 | Cloud Scheduler → Cloud Run Job による定期ポーリング（prod **1 分**、dev 5 分） |
| データ保持 | 生データ **28 日**（dev は 3 日）、日次集計は**無期限** |
| MBTA API キー | 開発の初期はなし（20 req/分 制限）。**prod の稼働前に取得**し、dev / prod で別のキーを使う（§10.1） |
| 画面更新 | ブラウザ → 自前 API を 15〜30 秒間隔でポーリング（DB の最新スナップショットを返す） |
| 地図 | MapLibre GL JS + OpenFreeMap（OSM ベース、API キー不要） |
| 認証 | IAP（Identity-Aware Proxy）で許可ユーザーのみ |
| GCP | `us-east4`、最小構成（コスト優先）。**dev / prod で別プロジェクト** |
| IaC / CI/CD | Terraform + GitHub Actions（WIF）。main への push 1 回で CI 1 回 → CD dev（自動）→ CD prod（承認後）（§10） |
| テスト | Vitest（単体）+ Playwright（E2E）、MBTA API はフィクスチャでモック |

---

## 2. アーキテクチャ

```
                         ┌──────────────────────── GCP (us-east4) ────────────────────────┐
                         │                                                                │
 MBTA V3 API  ◀──GET──── │  Cloud Run Job: collector     ◀── Cloud Scheduler (毎分/dev 5分) │
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
                         │   Secret Manager: DB パスワード, MBTA_API_KEY                    │
                         └────────────────────────────────────────────────────────────────┘
```

この構成を dev と prod の 2 つの GCP プロジェクトにそれぞれ作る（§10）。

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
- 認証: 開発の初期はキーなし。`MBTA_API_KEY` が設定されていれば `x-api-key` ヘッダーで送る（キーありの上限は 1000 req/分）。prod の稼働前にキーを取得する（§10.1）
- レート制限ヘッダー（2026-11 に実測で確認）: `x-ratelimit-limit: 20`、`x-ratelimit-remaining`、`x-ratelimit-reset`（**UNIX 秒**。次の分の境界）。値はログに残し、`collector_runs` に保存する
  - 注意: 連続したリクエストで `remaining` が 19→18→17→19→16→19→15 と増減した（サーバーごとに数えている模様）。`remaining` を当てにせず、§3 の予算を自前で守る
- 応答には `last-modified` ヘッダーが付く。応答は `Accept-Encoding` に応じて圧縮される（curl では zstd が返った）。サイズの見積もりは圧縮後の転送量で行う
- `fields[...]`（sparse fieldsets）で必要な属性だけを取得し、レスポンスを小さくする
- レスポンスは **必ず zod でパースして検証**する。スキーマに合わない行はスキップしてログに残し、ジョブ全体は落とさない

### 使用エンドポイント

| ジョブ | エンドポイント | 頻度 | 主なパラメータ |
|---|---|---|---|
| collector | `GET /vehicles` | 毎分 | `filter[route]=Red,Mattapan,Orange,Blue,Green-B,Green-C,Green-D,Green-E` |
| collector | `GET /predictions` | 毎分 | `filter[route]=<同上>`（predictions は stop/route/trip/位置のいずれかでのフィルタが必須） |
| collector | `GET /alerts` | 毎分 | `filter[route]=<同上>`（`filter[route_type]=0,1` でも同じ結果になることを確認済み） |
| sync-static | `GET /routes` | 毎日 | `filter[type]=0,1`（8 路線を確認済み） |
| sync-static | `GET /stops` ① | 毎日 | `filter[route_type]=0,1&include=parent_station`（ホームと親駅） |
| sync-static | `GET /stops` ② | 毎日 | `filter[id]=<①で得た親駅 125 件>&include=child_stops`（終点駅の番線などを補う。圧縮後 約 140KB） |
| sync-static | `GET /route_patterns` | 毎日 | `filter[route]=<同上>&include=representative_trip.shape,representative_trip.stops&fields[stop]=name,parent_station` |

#### 実測で確認したレスポンスの性質（2026-11-01）

- **`/routes`**: `color` は Red と Mattapan が `DA291C`、Green 4 支線はすべて `00843D`、Orange が `ED8B00`、Blue が `003DA5`。`direction_names` は Red / Orange が `South / North`、Green / Blue が `West / East`、Mattapan が `Outbound / Inbound`。`direction_destinations` もあり（例: Green-D は `Riverside / Union Square`）
- **`/stops`**: `data` に入るのは**ホーム（`location_type=0`）だけで 265 件**。親駅（`location_type=1`, `place-xxxx`）は `include=parent_station` を付けたときの `included` にだけ入る（125 件）。すべてのホームに親駅がある。`filter[location_type]` は不要
  - ただし**終点駅の番線などの 12 件はこの結果に含まれない**（`Alewife-01/02`, `Braintree-01/02`, `Forest Hills-01/02`, `Oak Grove-01/02`, `Union Square-01/02`, `Government Center-Brattle`, `71199`）。車両と予測の `stop` には実際にこれらが出てくる。そこで ② で親駅の `child_stops` を取得し、`location_type=0` かつ `vehicle_type` が 0 / 1 のものを追加する（child_stops にはバス停・通勤鉄道・出入口なども含まれるので、この条件で絞る）
  - それでも `stops` にない ID を collector が見つけたら、ログに残して `unknown_stop_ids` に記録し、次の sync-static で `filter[id]=` を使って取得する
- **`/route_patterns`**: 対象路線で絞っても、**臨時の代行バス路線（`Shuttle-*`, `typicality=4`）のパターンが混ざる**。`route_id` が対象 8 路線のものだけを残す。通常運行のパターンは `typicality=1`（`canonical=true`）の 18 件で、Red は方向ごとに Ashmont 行きと Braintree 行きの 2 パターンがある。停車順は `representative_trip.stops` で取れる（ホームの ID）。形状は `shape.polyline`（encoded polyline）。1 回のリクエストで全路線分が取れる（圧縮後 約 23KB）
- **`/alerts`**: フィードには **`lifecycle=UPCOMING`（まだ始まっていない予告）も含まれる**。「現在有効か」はフィードにあるかどうかではなく、`active_period` で判定する（`end` は `null` のことがある）。`informed_entity` の要素は `route`, `route_type`, `stop`（ホームと親駅の両方が出る）, `direction_id`（ないこともある）, `activities`。`header` 以外に `short_header`, `service_effect`, `timeframe` があり、UI の表示に使える
- **`/predictions`**（日曜 05:48 ET、運行中の車両 23 両の時点）: **416 件、非圧縮 251KB / 圧縮後 10KB**。平日の日中はこの数倍になる見込みだが、1 回のリクエストで問題なく取得できる（平日ピークの実測は §13）
  - 始発駅では `arrival_time` が `null` で、`departure_time` だけが入る
  - `schedule_relationship`: `null`（時刻表どおり）, `ADDED`（時刻表にない便。この時点では過半数）, `CANCELLED`（`arrival_time` と `departure_time` がどちらも `null`）, `SKIPPED`
  - `update_type` と不確かさ（`arrival_uncertainty` / `departure_uncertainty`、秒）は対応している: `MID_TRIP` = 60, `AT_TERMINAL` = 120, `REVERSE_TRIP`（終点で折り返した後の次の便の予測）= 360
  - `status` はほぼ `null`（まれに `Stopped 3 stops away` などの文字列）。`trip_headsign` は `null`。`last_trip`, `revenue` もある
  - trip ID には `ADDED-…` や `NONREV-…` で始まる、時刻表（GTFS）にない ID が多い
- **`/vehicles`**: 属性は `bearing`, `current_status`, `current_stop_sequence`, `direction_id`, `label`, `latitude`, `longitude`, `revenue`, `speed`, `occupancy_status`, `carriages[]`（車両ごとの `label` / `occupancy_status` / `occupancy_percentage`）, `updated_at`。リレーションは `route`, `stop`, `trip`
  - `stop` が `null` の車両がある
  - **`updated_at` が 25〜30 分前のまま更新されていない車両がある**（終点で待機中の Red Line の 2 両）
  - `speed` が入るのは Green と Mattapan だけ。`occupancy_status` は `null`、`carriages[].occupancy_status` は `NO_DATA_AVAILABLE`
  - 車両 ID は `R-…`, `O-…`, `G-…` の形式
- 日時は `2026-11-01T05:23:46-05:00` のような**オフセット付き**の文字列（夏時間の間は `-04:00`）。必ずオフセットを考慮してパースする

- route_type: `0` = Light Rail（Green 各支線, Mattapan）、`1` = Heavy Rail（Red, Orange, Blue）
- 予算: collector は **1 回あたり 3 リクエスト**、sync-static は 1 日あたり十数リクエスト。合計で常に **5 req/分以下** に収める
- ローカル開発も同じ IP 制限を共有する。開発中は `MBTA_FIXTURE_MODE=1` で `tests/fixtures/mbta/` のフィクスチャを使い、実 API は `pnpm job:collect` を手動で数回実行する程度にとどめる
- 429 を受けたら、その回はリトライせずに終了する（次の分の実行に任せる）
- 画面のフッターに出典表記 `Data provided by MBTA` と地図タイルの帰属表示（OpenFreeMap / © OpenStreetMap contributors）を必ず出す

### ID の扱い

- 予測と車両の `stop` は**ホーム（child stop, 例: `70061`）**を指す。分析と UI では**親駅（`place-xxxx`）**に寄せて集計する（`stops.parent_station_id` で対応づける）
- Green Line の幹線区間（Kenmore〜Government Center など、支線が共有する駅）での運行間隔は、支線別に加えて**全支線合算（`Green`）**でも計算する
- Red Line は Ashmont 支線と Braintree 支線が同じ route ID `Red` なので、幹線区間（Alewife〜JFK/UMass）の運行間隔は自然に両支線の合算になる。支線ごとの値が必要なときは route pattern で分ける
- 運行日（service date）: MBTA の運行日は日付をまたぐため、`America/New_York` の時刻から **3 時間引いた日付**を運行日とする（`src/lib/time.ts` に一元化）

---

## 4. データモデル（Drizzle / PostgreSQL）

時刻はすべて `timestamptz`（UTC）で保存する。テーブル名は snake_case。

### 4.1 静的データ（sync-static が毎日 upsert）

- `routes` — `id` PK, `short_name`, `long_name`, `type`, `color`, `text_color`, `direction_names` jsonb, `direction_destinations` jsonb, `sort_order`
- `stops` — `id` PK, `name`, `lat`, `lon`, `location_type`, `parent_station_id`, `platform_name`, `vehicle_type`（ホームと親駅の両方を保存する）
- `route_patterns` — `id` PK, `route_id`, `direction_id`, `name`, `typicality`, `canonical`, `shape_polyline`（encoded polyline）, `platform_stop_ids` jsonb（停車順のホーム ID）, `station_ids` jsonb（停車順の親駅 ID）。保存するのは対象 8 路線のパターンだけ

路線の色は API の `routes.color` を使い、コードに直接書かない。

### 4.2 現在値テーブル（collector が毎分、トランザクション内で入れ替え）

- `vehicles_current` — `vehicle_id` PK, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`（`INCOMING_AT` / `STOPPED_AT` / `IN_TRANSIT_TO`）, `stop_id`, `current_stop_sequence`, `label`, `revenue`, `speed`, `carriages` jsonb, `updated_at`, `polled_at`
- `predictions_current` — `id` PK, `route_id`, `trip_id`, `stop_id`, `direction_id`, `stop_sequence`, `arrival_time`, `departure_time`, `status`, `schedule_relationship`, `update_type`, `uncertainty_sec`, `vehicle_id`, `polled_at`
- `alerts` — `id` PK, `effect`, `cause`, `severity`（整数）, `header`, `short_header`, `service_effect`, `timeframe`, `description`, `lifecycle`, `active_period` jsonb, `informed_entity` jsonb, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `in_feed`
  - アラートは削除せず upsert。フィードから消えたら `in_feed=false` にする
  - 「現在有効か」は列として持たず、`active_period` と現在時刻から計算する（UPCOMING のアラートがフィードに含まれるため）
- `alert_routes` — (`alert_id`, `route_id`) PK（路線別集計用）

### 4.3 履歴テーブル（生データ。28 日で削除）

日単位のパーティション（PostgreSQL の宣言的パーティショニング）にして、保持期間の削除はパーティションごと `DROP` する。**集計が成功していない運行日のパーティションは、保持期間を過ぎても削除しない**（`aggregate` Job が数日失敗し続けても、集計前の生データを失わないようにするため。保持期間の短い dev で特に効く）。Drizzle はパーティションを扱えないので、`drizzle/` 配下に手書き SQL のマイグレーションとして作る。

- `vehicle_positions` — `vehicle_id`, `updated_at`, `polled_at`, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`, `stop_id`, `current_stop_sequence`。PK (`vehicle_id`, `updated_at`)。`updated_at` が前回と同じ車両は保存しない
- `prediction_samples` — `service_date`, `trip_id`, `stop_id`, `lead_bucket_min`, `route_id`, `direction_id`, `update_type`, `uncertainty_sec`, `predicted_arrival_at`, `observed_at`。PK (`service_date`, `trip_id`, `stop_id`, `lead_bucket_min`)
  - 全予測を毎分保存すると 28 日でも数千万行規模になるので、**リード時間バケット `[1, 3, 5, 10, 15]` 分ごとに 1 件だけ**保存する（§5.2）
- `arrival_events` — `service_date`, `trip_id`, `stop_id`（親駅）, `route_id`, `direction_id`, `vehicle_id`, `arrived_at`, `source`（`stopped_at` / `predicted_last` / `interpolated`）, `precision_sec`。PK (`service_date`, `trip_id`, `stop_id`)
- `collector_runs` — `id`, `job`, `started_at`, `finished_at`, `status`, `counts` jsonb, `ratelimit_remaining`, `error`
- `unknown_stop_ids` — `stop_id` PK, `first_seen_at`, `resolved_at`（`stops` にない ID を collector が見つけたときに記録する。§3）

### 4.4 集計テーブル（aggregate が毎日作成。無期限保持）

- `daily_headway_stats` — `service_date`, `route_id`（`Green` 合算を含む）, `direction_id`, `stop_id`, `hour`（0–23, ET）, `n`, `mean_sec`, `p50_sec`, `p90_sec`, `max_sec`, `bunching_count`, `gap_count`
- `daily_prediction_accuracy` — `service_date`, `route_id`, `direction_id`, `lead_bucket_min`, `update_type`, `hour`, `n`, `mean_error_sec`, `mean_abs_error_sec`, `p90_abs_error_sec`, `within_60s_ratio`
- `daily_alert_stats` — `service_date`, `route_id`, `effect`, `cause`, `alert_count`, `active_minutes`

曜日 × 時間帯のヒートマップは、これらのテーブルの `service_date` の曜日と `hour` から作る。

> **注意**: 集計の定義を後から変えても、生データが残っている直近 28 日分（dev は 3 日分）しか再集計できない。それより古い期間は、変更前の定義で集計した値のまま残る。集計の定義を変えたら `aggregate` Job を保持期間分さかのぼって再実行し、変更日を `docs/` か本ファイルに記録する

### データ量の目安

- `vehicle_positions`: 約 150 両 × 1,440 回/日 ≒ 20 万行/日 → 28 日で約 560 万行
- `prediction_samples`: 到着イベント約 4 万件/日 × 5 バケット ≒ 20 万行/日
- 最小構成の Cloud SQL（10GB）に収まる見込み。容量は `collector_runs` と Cloud Monitoring で監視する

---

## 5. 分析指標の定義

指標の定数（しきい値やバケット）は `src/lib/metrics/constants.ts` に集めて調整できるようにする。

### 5.1 実到着の検出（`arrival_events`）

collector は毎回、前回の `vehicles_current` と今回の取得結果を比べて到着を検出する。`updated_at` が 3 分以上前の車両（更新が止まっている車両）と `revenue != REVENUE` の車両は対象にしない。

1. 車両が `STOPPED_AT` で駅 S にいて、(trip, S) のイベントがまだない → `arrived_at = vehicle.updated_at`, `source = stopped_at`
2. `current_stop_sequence` が k から m（m > k）に進み、途中の駅にイベントがない → 前回の `predictions_current` にあるその (trip, 駅) の `arrival_time` を使う。`source = predicted_last`
3. 前回の予測もない → 前後の観測時刻から線形補間する。`source = interpolated`

> **既知の制約**: 1 分間隔のポーリングでは停車時間（30〜60 秒）の短い停車を取りこぼすため、到着時刻の精度は **±60 秒程度**。UI の分析画面にこの注記を出す。改善策（API キーを取得して 30 秒間隔にする）は §11 を参照。

### 5.2 予測誤差（Prediction Accuracy）

- 各回の予測について、リード時間 `lead = predicted_arrival - observed_at` を計算する。`lead` 以上で最小のバケット b ∈ `[1, 3, 5, 10, 15]` 分に `INSERT ... ON CONFLICT DO NOTHING` で保存する（各バケットで最初の観測を残す）
- `error_sec = actual_arrival - predicted_arrival`（**正の値 = 予測より遅く到着**）
- 実到着は `arrival_events` と (service_date, trip_id, 親駅) で突き合わせる。`source = interpolated` のイベントは精度集計から除く
- `schedule_relationship` が `CANCELLED` / `SKIPPED` の予測と、`arrival_time` が `null` の予測（始発駅）は保存しない
- 予測の種類によって精度は大きく違うはずなので、`update_type`（`MID_TRIP` / `AT_TERMINAL` / `REVERSE_TRIP`）別にも集計する
- 指標: 平均誤差（バイアス）、平均絶対誤差、p90 絶対誤差、±60 秒以内の割合

### 5.3 運行間隔（Headway）

- (route, direction, 親駅) ごとに `arrived_at` を並べ、連続する到着の差を運行間隔とする
- 60 分を超える間隔は運休時間帯とみなして除外する
- **団子運転（bunching）**: 間隔 < 2 分
- **間隔の開き（gap）**: 間隔 > 同じ (route, direction, 駅, 曜日種別, hour) の過去 28 日の中央値 × 2。基準の中央値は、生データではなく `daily_headway_stats` の `p50_sec` から求める（生データの保持期間に左右されないようにするため）

### 5.4 アラート

- 件数: (運行日, route, effect, cause) ごとに、`active_period` がその日に重なり、かつその日にフィードで観測されたアラートの数（予告だけの UPCOMING は数えない）
- 継続時間: `active_period` と `first_seen_at`〜`last_seen_at` が重なる区間のうち、その日に含まれる分数
- 実測で観測した値（2026-11-01 の 15 件。値は列挙型として固定せず、未知の値もそのまま保存する）
  - effect: `NOTICE`, `STATION_ISSUE`, `STATION_CLOSURE`, `SUSPENSION`, `SHUTTLE`, `DELAY`
  - cause: `UNKNOWN_CAUSE`, `MAINTENANCE`, `CONSTRUCTION`, `SINGLE_TRACKING`
  - severity: `1`, `3`, `4`, `7`（整数）
  - lifecycle: `NEW`, `ONGOING`, `UPCOMING`
- 分析画面では、遅延系（`DELAY`, `SUSPENSION`, `SHUTTLE`, `STATION_CLOSURE`）とお知らせ系（`NOTICE`, `STATION_ISSUE` など）を分けて表示する

---

## 6. 画面仕様（UI は英語）

共通: ヘッダーに `Last updated: hh:mm:ss ET` を表示する。collector の最終成功から 3 分以上経ったら警告バナー `Live data is stale` を出す。

| パス | 画面 | 内容 |
|---|---|---|
| `/` | **Live Map** | MapLibre で路線形状を路線色で描き、車両を進行方向（bearing）に回転させた矢印で表示。路線フィルタのトグル。車両をクリックするとポップアップ（路線、行先、次の駅、状態、何秒前の情報か）。`updated_at` が 3 分以上前の車両は灰色で表示する。15 秒ごとに更新 |
| `/stations` | **Stations** | 駅の一覧と検索（路線別にまとめる） |
| `/stations/[stopId]` | **Arrival Board** | 方向別に次の列車 3 本の `n min` 表示。到着予定時刻からブラウザ側でカウントダウンし、30 秒ごとに更新。始発駅では `departure_time` を使う。`CANCELLED` の便は `Cancelled` と表示し、`SKIPPED` は表示しない。その駅に関係するアラートも表示 |
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
├── infra/terraform/         # bootstrap/, modules/app/, envs/{dev,prod}/（§10.3）
└── .github/workflows/       # pipeline.yml, rollback.yml（§10.4, §10.5）
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
| `APP_ENV` | `local` / `dev` / `prod`。画面に環境バッジを出すためだけに使う（§10.1） |
| `RAW_RETENTION_DAYS` | 生データの保持日数（dev 3 / prod 28） |

`.env.local` はコミットしない。`.env.example` を用意して最新に保つ。

---

## 10. インフラと CI/CD

### 10.1 環境

1 つのリポジトリで **dev** と **prod** の 2 環境を管理する。環境ごとに Google Cloud プロジェクトを分ける。

| | dev | prod |
|---|---|---|
| GCP プロジェクト | `<dev-project-id>`（未定） | `<prod-project-id>`（未定） |
| デプロイ | main への push で**自動**（承認なし） | dev へのデプロイ成功後、**承認されてから** |
| collector の間隔 | **5 分**（`*/5 * * * *`） | **1 分**（`* * * * *`） |
| 生データの保持 | 3 日 | 28 日 |
| Cloud SQL | `db-f1-micro`、バックアップ 1 日、`deletion_protection=false` | `db-f1-micro`、バックアップ 7 日、`deletion_protection=true` |
| IAP で許可するユーザー | 開発者 | 利用者（開発者を含む） |
| MBTA API キー | dev 用のキー | prod 用のキー |
| 予算アラート | 小さめ | 本番相当 |

- dev は 5 分間隔なので、到着検出の精度はかなり低い（§5.1）。dev の分析画面は表示の確認用と割り切り、数値の妥当性は prod で確認する
- **MBTA API キーは prod の稼働前に取得する**。Cloud Run の送信元 IP は他の GCP 利用者と共有されるため、キーなしの「IP 単位 20 req/分」を他人に使い切られて 429 になる可能性がある。dev と prod で別のキーを使い、各プロジェクトの Secret Manager に入れる
- 環境ごとの違いは Terraform の変数（`envs/<env>/terraform.tfvars`）と Cloud Run の環境変数だけで表現する。**コードの中で環境名による分岐を書かない**（例外: `APP_ENV` を画面のヘッダーに `DEV` バッジとして表示するだけ）

### 10.2 GCP のリソース配置

```
<prod-project>                                   <dev-project>
├─ Artifact Registry: mbta-live (イメージは1つ)   │
│    └─ dev の Cloud Run サービスエージェントに reader を付与 ──▶ 同じイメージを pull
├─ GCS: Terraform state (prod)                  ├─ GCS: Terraform state (dev)
├─ WIF pool/provider (GitHub)                   ├─ WIF pool/provider (GitHub)
├─ SA: ci-builder（イメージの push だけ）          │
├─ SA: deployer-prod                            ├─ SA: deployer-dev
└─ アプリ一式（§2 の構成）                        └─ アプリ一式（§2 の構成）
```

- イメージは prod プロジェクトの Artifact Registry に **1 つだけ**置き、dev と prod は同じダイジェストを使う
- Terraform state は環境ごとに、そのプロジェクトの GCS バケットに置く

### 10.3 Terraform の構成（`infra/terraform/`）

```
infra/terraform/
├── bootstrap/          # 最初に一度だけ人が手動で apply する: API の有効化、state バケット、
│                       # Artifact Registry、WIF、deployer / ci-builder の SA
├── modules/app/        # アプリ一式: Cloud SQL、Secret Manager、Cloud Run（web）、Cloud Run Jobs、
│                       # Cloud Scheduler、IAP、実行用の SA、予算アラート
└── envs/
    ├── dev/            # backend.tf（dev の state）+ main.tf（module "app"）+ terraform.tfvars
    └── prod/
```

- `envs/dev` と `envs/prod` は同じ `modules/app` を呼び、違いは `terraform.tfvars` だけにする
- `terraform.tfvars` にはプロジェクト ID や間隔などの**公開してよい値だけ**を書く。**このリポジトリは public** なので、IAP で許可するメールアドレスなどは GitHub Environment の secret（`TF_VAR_iap_members`）で渡す
- イメージのタグはパイプラインが更新するので、Terraform では `lifecycle { ignore_changes = [image] }` にする
- web の Cloud Run は `min-instances=0`。IAP は Cloud Run に直接組み込む方式（`--iap`）を使う。使えない場合は外部 HTTPS LB + Serverless NEG + IAP にする
- collector Job: タスクのタイムアウト 50 秒、リトライ 0。実行が重なったときは `pg_try_advisory_lock` で後の実行を即終了させる
- Cloud Scheduler の時刻は `America/New_York` で指定する

### 10.4 パイプライン（`.github/workflows/pipeline.yml`）

**main への push 1 回につき、CI を 1 回、CD を 2 回（dev → prod）実行する。** イメージは CI で 1 回だけビルドし、同じダイジェストを dev と prod に順にデプロイする（再ビルドしない）。

```
push to main
  │
  ├─ ci            （environment なし）
  │    pnpm install → lint → typecheck → vitest → Playwright（Postgres サービスコンテナ + フィクスチャ）
  │    → docker build → Artifact Registry に push（タグ = git SHA）→ outputs: image_digest
  │    → terraform fmt -check / validate → dev と prod の terraform plan（結果をジョブサマリーに出す）
  │
  ├─ cd-dev        （environment: dev / 承認なし / needs: ci）
  │    WIF で deployer-dev として認証
  │    → terraform apply（envs/dev）
  │    → migrate Job をそのイメージで実行
  │    → web をデプロイし、各 Job のイメージを更新（どちらもダイジェスト指定）
  │    → スモークテスト: collector Job を 1 回実行（--wait）して成功を確認
  │
  └─ cd-prod       （environment: prod / Required reviewers で承認待ち / needs: cd-dev）
       cd-dev と同じ手順を envs/prod とプロジェクト prod で実行
```

#### GitHub の設定

- Environment `dev`: 保護ルールなし。Deployment branches は `main` だけ
- Environment `prod`: **Required reviewers**（リポジトリのオーナー）。Deployment branches は `main` だけ
- 環境ごとの値（プロジェクト ID、WIF provider、SA のメールアドレス）は各 Environment の variables に置く。秘密の値は Environment の secrets に置く
- `concurrency`: CI は `pipeline-main`、デプロイは `deploy-dev` / `deploy-prod` のグループにし、`cancel-in-progress: false` にする（デプロイ中のジョブを途中で止めない）

#### ルール

- **イメージは環境に依存させない**。`NEXT_PUBLIC_*` のようにビルド時に値が埋め込まれる環境変数に、環境ごとの値を入れない。環境ごとの設定はすべて実行時の環境変数で渡す
- **cd-prod は、`github.sha` が現在の main の HEAD でなければ失敗させる**。承認待ちの古い run を承認して古いイメージを prod に戻してしまう事故を防ぐため。承認するのは常に最新の run にする
- **prod の Terraform は、承認したときに見た plan と同じ内容だけを apply する**。CI で prod の plan の `resource_changes` のハッシュを出力しておき、cd-prod で plan し直したときのハッシュと違えば apply せずに失敗させる（方式は実装時に検証する）
- plan ファイルは artifact としてアップロードしない（public リポジトリでは artifact とログを誰でも見られ、plan ファイルには秘密の値が含まれうるため）。ログに秘密の値を出さない
- マイグレーションはデプロイ前に実行されるので、**古いバージョンのコードでも動くように**書く（expand → contract の 2 段階に分ける。列の削除やリネームは次のリリースで行う）。dev が先に通るので、壊れたマイグレーションは dev で止まる
- CI が失敗したら dev にも prod にもデプロイしない。push する前にローカルで `pnpm lint && pnpm typecheck && pnpm test` を実行する（PR だけでは CI は走らない）

#### 認証（Workload Identity Federation）

- サービスアカウントのキー（JSON）は使わない
- WIF の provider の attribute condition で `assertion.repository == "tsatolol/mbta_live"` かつ `assertion.ref == "refs/heads/main"` に限定する
- deployer SA の `roles/iam.workloadIdentityUser` の付与は、OIDC トークンの `environment` クレームで絞る（deployer-prod は `environment == "prod"` のジョブからしか使えない）
- ci-builder は Artifact Registry への書き込み権限だけを持つ。deployer は自分の環境のリソースだけを操作できる

### 10.5 ロールバック（`.github/workflows/rollback.yml`）

- `workflow_dispatch` で環境とイメージのダイジェストを指定して実行する。`environment: prod` を付けるので、prod では承認が必要
- 行うのは web と各 Job のイメージの差し替えだけ。Terraform の apply とマイグレーションは実行しない（マイグレーションは expand → contract で書いているので、1 つ前のイメージはそのまま動く）

---

## 11. 実装フェーズ

分析には履歴データが必要なので、**collector をできるだけ早く本番で動かし始める**。

1. **Phase 0 — 土台**: Next.js の雛形、docker-compose、Drizzle のスキーマ、MBTA クライアント + zod スキーマ、フィクスチャの記録
2. **Phase 1 — 収集**: `sync-static` と `collect`（現在値テーブル、履歴テーブル、到着検出）。ローカルで動作確認する
3. **Phase 2 — 本番の基盤**: GCP プロジェクト 2 つの作成、`bootstrap` の手動 apply、`modules/app` と `envs/dev`・`envs/prod`、パイプライン、IAP、MBTA API キーの取得。prod で collector を動かしてデータの蓄積を始める
4. **Phase 3 — リアルタイム画面**: Live Map、Stations / Arrival Board、Alerts、Status
5. **Phase 4 — 分析**: `aggregate` Job、保持期間の処理、分析画面 4 つ
6. **Phase 5 — 改善（任意）**: 時刻表（`/schedules`）との比較による遅延指標（`ADDED-…` / `NONREV-…` の便は時刻表にないので、trip 単位ではなく運行間隔で比べる必要がある）、API キーを取得して 30 秒間隔の収集にする（到着検出の精度向上）、アラート通知

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

- [ ] dev / prod の GCP プロジェクト ID、請求先アカウント、それぞれの予算アラートの金額
- [ ] prod の Required reviewers を誰にするか（現状はリポジトリのオーナーのみを想定）
- [ ] MBTA API キーの取得（dev 用・prod 用）
- [ ] 独自ドメインを使うか（使わない場合は Cloud Run の URL）
- [x] 実 API で確認済み（2026-11-01）: `/stops` の取得方法、`/route_patterns` の中身、レート制限ヘッダー、alerts の `effect` / `cause` などの値（§3）
- [x] 運行中の `/predictions` と `/vehicles` の属性、終点駅の番線 ID の扱い（§3）
- [ ] 平日の日中ピークに `/predictions` の件数とサイズを測る（日曜早朝は 416 件、非圧縮 251KB）
- [ ] bunching / gap のしきい値（§5.3）を実データを見て調整する
- [ ] 時刻表との比較（Phase 5）をするかどうか
