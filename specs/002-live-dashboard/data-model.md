# Data Model: リアルタイム画面

この feature は新しいテーブルを作らない。001 のテーブル（`specs/001-data-collection/data-model.md`）を読む。

## 読むテーブル

| 画面 | テーブル |
|---|---|
| Live Map | `vehicles_current`, `routes`, `route_patterns`（形状）, `stops` |
| Stations / Arrival Board | `stops`, `route_patterns`（停車順）, `predictions_current`, `alerts`, `alert_routes` |
| Alerts | `alerts`, `alert_routes` |
| System Status | `collector_runs`, 各テーブルの行数 |

## 画面側で計算する値

- **車両が古いか（`isStale`）**: `now - updated_at >= 3 分`
- **アラートの状態**: `active_period` のいずれかの区間に現在時刻が入っていれば `active`、すべての区間が未来なら `upcoming`、それ以外は `past`
- **あと何分か**: `arrival_time`（始発駅は `departure_time`）から現在時刻を引いた値を、ブラウザで毎秒計算する
- **データが古いか（stale バナー）**: 最後に成功した `collector_runs.finished_at` から 3 分以上経っているか
