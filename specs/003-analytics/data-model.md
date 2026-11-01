# Data Model: 分析

入力は 001 の `arrival_events`, `prediction_samples`, `alerts`, `alert_routes`（`specs/001-data-collection/data-model.md`）。集計の SQL は TypedSQL（`prisma/sql/*.sql`）で書く。指標の定数は `src/lib/metrics/constants.ts` に集める。

## 集計テーブル（aggregate ジョブが毎日作成。無期限保持）

| テーブル | 列 |
|---|---|
| `daily_headway_stats` | `service_date`, `route_id`（`Green` 合算を含む）, `direction_id`, `stop_id`, `hour`（0–23, ET）, `n`, `mean_sec`, `p50_sec`, `p90_sec`, `max_sec`, `bunching_count`, `gap_count` |
| `daily_prediction_accuracy` | `service_date`, `route_id`, `direction_id`, `lead_bucket_min`, `update_type`, `hour`, `n`, `mean_error_sec`, `mean_abs_error_sec`, `p90_abs_error_sec`, `within_60s_ratio` |
| `daily_alert_stats` | `service_date`, `route_id`, `effect`, `cause`, `alert_count`, `active_minutes` |
| `aggregate_runs` | `service_date` PK, `status`, `finished_at`, `definition_version` |

- 曜日 × 時間帯のヒートマップは、`service_date` の曜日と `hour` から作る
- `aggregate_runs.status = success` の運行日だけ、001 の生データのパーティションを削除してよい
- `definition_version` は指標の定義の版。定義を変えたら上げ、保持期間分さかのぼって再集計する。それより古い期間は旧定義の値のまま残るので、画面で版の境目が分かるようにする

## 指標の定義

### 運行間隔（Headway）

- (route, direction, 親駅) ごとに `arrival_events.arrived_at` を並べ、連続する到着の差を運行間隔とする
- 60 分を超える間隔は運休時間帯とみなして除外する
- **団子運転（bunching）**: 間隔 < 2 分
- **間隔の開き（gap）**: 間隔 > 同じ (route, direction, 駅, 曜日種別, hour) の過去 28 日の中央値 × 2。基準の中央値は生データではなく `daily_headway_stats.p50_sec` から求める（生データの保持期間に左右されないようにするため）
- Green Line の幹線区間では、支線別に加えて `route_id = Green`（全支線合算）でも計算する

### 予測誤差（Prediction Accuracy）

- `error_sec = actual_arrival - predicted_arrival`（**正の値 = 予測より遅く到着**）
- 実到着は `arrival_events` と (service_date, trip_id, 親駅) で突き合わせる
- `source = interpolated` の到着イベントは除く
- 指標: 平均誤差（バイアス）、平均絶対誤差、p90 絶対誤差、±60 秒以内の割合。リード時間のバケットと予測の種類（`update_type`）ごとに出す

### アラート

- 件数: (運行日, route, effect, cause) ごとに、`active_period` がその日に重なり、かつその日にフィードで観測されたアラートの数（予告だけの UPCOMING は数えない）
- 継続時間: `active_period` と `first_seen_at`〜`last_seen_at` が重なる区間のうち、その日に含まれる分数
- 画面では、遅延系（`DELAY`, `SUSPENSION`, `SHUTTLE`, `STATION_CLOSURE`）とお知らせ系（`NOTICE`, `STATION_ISSUE` など、それ以外すべて）に分ける
