# データモデル: データ収集

PostgreSQL 16（Cloud SQL）。時刻はすべて `timestamptz`（UTC）。テーブル名と列名は snake_case。集計テーブルは `specs/003-analytics/data-model.md` を参照。

## Prisma での扱い

- Prisma ORM の最新安定版を使う。接続は driver adapter（`@prisma/adapter-pg` + `pg`）経由。Cloud Run では Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>` に接続する
- `prisma/schema.prisma` のモデル名は PascalCase、フィールド名は camelCase で書き、`@@map` / `@map` で snake_case に対応づける。時刻の列には `@db.Timestamptz` を付ける
- 生成したクライアントは `src/generated/prisma`（gitignore）。`prisma generate` は `postinstall`、CI、Docker のビルドで実行する
- 書き込み
  - `INSERT ... ON CONFLICT DO NOTHING` は `createMany({ skipDuplicates: true })` で書く
  - 現在値テーブルの入れ替えは `$transaction` の中で `deleteMany` → `createMany`
  - 1 行ずつの `upsert` を毎分数百回呼ばない。件数の多い upsert は `$executeRaw` で 1 本の SQL にまとめる
- パーティションを使うテーブル（下の「履歴」）
  - Prisma のスキーマでは `PARTITION BY` を表現できない。親テーブルは `schema.prisma` にモデルとして書き、実際の `CREATE TABLE ... PARTITION BY RANGE` は `prisma migrate dev --create-only` で作ったマイグレーション SQL を手で書き換えて作る
  - 日ごとの子テーブルはマイグレーションではなく `aggregate` ジョブが作成・削除する。子テーブルはスキーマ `partitions` に置き、Prisma の管理対象（`public`）に入れない。`prisma migrate dev` が子テーブルを drift とみなさないようにするため。この方式で drift が出ないことは確認済み（2026-11-02。`prisma migrate dev` が「Already in sync」、`prisma migrate diff` が「No difference detected」。`tests/integration/prisma-drift.test.ts` で継続して確かめる）
- 本番とパイプラインでは `prisma migrate deploy` だけを使う。`migrate dev` と `db push` はローカル専用

## ID と日付の扱い

- 車両と予測の `stop` はホーム（例: `70061`, `Alewife-01`）を指す。分析と画面では親駅（`place-xxxx`）に寄せる（`stops.parent_station_id`）
- Green Line の幹線区間（支線が共有する駅）では、支線別に加えて全支線合算（`Green`）でも集計する
- Red Line の 2 支線は同じ route ID `Red` なので、幹線区間（Alewife〜JFK/UMass）では自然に合算になる。支線別が必要なときは路線パターンで分ける
- 運行日（service date）は、`America/New_York` の時刻から 3 時間引いた日付（`src/lib/time.ts` に一元化）

## 静的データ（sync-static が毎日 upsert）

- 取得がすべて成功したときだけ、1 つのトランザクションで書き込む。路線・駅・対象の路線パターンのどれかが 0 件なら、既存のデータを守るため書き込まずに失敗にする
- `stops` と `routes` は削除しない（過去のデータが参照しているため）。`route_patterns` は今回の応答にないものを削除する（古い停車順を到着検出に使わないため）
- `unknown_stop_ids`: collector は、車両と予測の `stop` のうち駅の索引にないものを記録する（既にあれば `first_seen_at` を保つ）。sync-static は ①② で見つかったものを解決済みにし、残りを ③ で取得する。③ でも見つからないものは未解決のまま残し、ログに出す

| テーブル | 列 | 備考 |
|---|---|---|
| `routes` | `id` PK, `short_name`, `long_name`, `type`, `color`, `text_color`, `direction_names` jsonb, `direction_destinations` jsonb, `sort_order` | 対象 8 路線 |
| `stops` | `id` PK, `name`, `lat`, `lon`, `location_type`, `parent_station_id`, `platform_name`, `vehicle_type` | 親駅とホームの両方 |
| `route_patterns` | `id` PK, `route_id`, `direction_id`, `name`, `typicality`, `canonical`, `shape_polyline`, `platform_stop_ids` jsonb, `station_ids` jsonb | 対象 8 路線のパターンだけ |

## 現在値（collector が毎回、トランザクション内で入れ替え）

| テーブル | 列 |
|---|---|
| `vehicles_current` | `vehicle_id` PK, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`, `stop_id`, `current_stop_sequence`, `label`, `revenue`, `speed`, `carriages` jsonb, `updated_at`, `polled_at` |
| `predictions_current` | `id` PK, `route_id`, `trip_id`, `stop_id`, `direction_id`, `stop_sequence`, `arrival_time`, `departure_time`, `status`, `schedule_relationship`, `update_type`, `uncertainty_sec`, `vehicle_id`, `polled_at` |
| `alerts` | `id` PK, `effect`, `cause`, `severity`, `header`, `short_header`, `service_effect`, `timeframe`, `description`, `lifecycle`, `active_period` jsonb, `informed_entity` jsonb, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `in_feed` |
| `alert_routes` | (`alert_id`, `route_id`) PK |

- アラートは削除せずに upsert する。フィードから消えたら `in_feed=false` にする
- 「現在有効か」は列として持たず、`active_period` と現在時刻から計算する（UPCOMING がフィードに含まれるため）

## 履歴（生データ。日ごとのパーティション。prod 28 日 / dev 3 日で削除）

| テーブル | 列 | PK |
|---|---|---|
| `vehicle_positions` | `vehicle_id`, `updated_at`, `polled_at`, `route_id`, `trip_id`, `direction_id`, `lat`, `lon`, `bearing`, `current_status`, `stop_id`, `current_stop_sequence` | (`vehicle_id`, `updated_at`) |
| `prediction_samples` | `service_date`, `trip_id`, `stop_id`, `lead_bucket_min`, `route_id`, `direction_id`, `update_type`, `uncertainty_sec`, `predicted_arrival_at`, `observed_at` | (`service_date`, `trip_id`, `stop_id`, `lead_bucket_min`) |
| `arrival_events` | `service_date`, `trip_id`, `stop_id`（親駅）, `route_id`, `direction_id`, `vehicle_id`, `arrived_at`, `source`, `precision_sec` | (`service_date`, `trip_id`, `stop_id`) |

- `vehicle_positions` は `updated_at` が前回と同じ車両を保存しない。collector は前日・当日・翌日の運行日のパーティションを毎回作り、`updated_at` がそれ以外の運行日になる車両（数日前から更新の止まった車両など）の位置は保存しない（件数は `collector_runs.counts.positionsSkipped`）
- `vehicles_current.carriages` は `[{ label, occupancyStatus, occupancyPercentage }]` の形の JSON
- 保持期間の削除はパーティションごと `DROP` する。**集計が済んでいない運行日のパーティションは、保持期間を過ぎても削除しない**

## 運用記録

| テーブル | 列 |
|---|---|
| `collector_runs` | `id`, `job`, `started_at`, `finished_at`, `status`, `counts` jsonb, `ratelimit_remaining`, `error` |
| `unknown_stop_ids` | `stop_id` PK, `first_seen_at`, `resolved_at` |

## 到着の検出（`arrival_events`）

collector は毎回、前回の `vehicles_current` と今回の取得結果を比べて到着を検出する。`updated_at` が 3 分以上前の車両と、`revenue != REVENUE` の車両は対象にしない。

1. 車両が `STOPPED_AT` で駅 S にいて、(trip, S) のイベントがまだない → `arrived_at = vehicle.updated_at`, `source = stopped_at`
2. `current_stop_sequence` が k から m（m > k）に進み、途中の駅にイベントがない → 前回の `predictions_current` にあるその (trip, 駅) の `arrival_time`（なければ `departure_time`）を使う。`source = predicted_last`
3. 前回の予測もない → 前後の観測時刻から線形補間する。`source = interpolated`

実装（`src/lib/metrics/arrivals.ts`）の詳細:

- 「進んだ区間の駅」は、路線パターンの停車順（親駅）で前回の駅と今回の駅の間にある駅。前回が停車中なら前回の駅は含めず、向かっている途中なら含める。今回の駅は含めない（今回停車中なら 1. で記録する）。該当する路線パターンがなければ、前回の予測の `stop_sequence` の順を使う
- 便が変わった車両（折り返しなど）は、進んだ区間を推定しない
- 前回の予測で `SKIPPED` / `CANCELLED` の駅は、到着を記録しない
- `predicted_last` の時刻は、前回と今回の `updated_at` の間に収める。区間の中では停車順に沿って時刻が減らないようにする
- 補間は、前回と今回の `updated_at` の間を「区間の駅の数 + 1」で等分する
- `precision_sec`: `stopped_at` と `predicted_last` は前回の収集からの経過秒数（前回がなければ 60）、`interpolated` は前回と今回の `updated_at` の差
- 駅の索引にない stop ID は記録せず、件数を `collector_runs.counts.unknownStopIds` に残す
- 同じ便・親駅の到着は、DB の主キーにより最初に記録したものが残る
- 既知の制約: 始発駅で発車を待っている車両も `STOPPED_AT` なので、始発駅には「その便で最初に停車を観測した時刻」が到着として記録される（実際の到着ではない）

2026-11-02 の平日 12:28 ET からの 4 回分の実データでは、`stopped_at` が 130 件、`predicted_last` が 26 件で、`interpolated` は 0 件だった

> 1 分間隔では短い停車（30〜60 秒）を取りこぼすため、精度は ±60 秒程度。改善策は API キーを取得して 30 秒間隔にすること。

## 予測のサンプリング（`prediction_samples`）

- 各回の予測について `lead = predicted_arrival - observed_at` を計算し、`lead` 以上で最小のバケット b ∈ `[1, 3, 5, 10, 15]` 分に `createMany({ skipDuplicates: true })` で保存する（各バケットで最初の観測が残る）
- `schedule_relationship` が `CANCELLED` / `SKIPPED` の予測と、`arrival_time` が `null` の予測（始発駅）は保存しない
- 実装（`src/lib/metrics/sampling.ts`）の詳細: `stop_id` は親駅、`service_date` は予測到着時刻の運行日（到着イベントと突き合わせるため）。リード時間が 0 以下か 15 分を超える予測、駅の索引にないホームの予測は保存しない。`ADDED`（時刻表にない便）は保存する
- 2026-11-02 の平日 12:28 ET からの 4 回分の実データでは、1 回目が 610 件（それまでの分がまとめて入る）、2 回目以降は 1 分あたり 150〜213 件だった（1 日の運行時間に換算して約 20 万行）

## データ量の目安

- `vehicle_positions`: 約 150 両 × 1,440 回/日 ≒ 20 万行/日 → 28 日で約 560 万行
- `prediction_samples`: 到着イベント約 4 万件/日 × 5 バケット ≒ 20 万行/日（全件を毎分保存すると 28 日でも数千万行規模になるため、バケットで間引く）
- Cloud SQL の最小構成（10GB）に収まる見込み。容量は `collector_runs` と Cloud Monitoring で監視する
