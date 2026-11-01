# Contract: リアルタイム画面の内部 API（Next.js Route Handlers）

- すべて GET、読み取り専用。DB だけを読み、MBTA API は呼ばない
- クエリパラメータは zod で検証し、不正な値には `400 { "error": string }` を返す
- 時刻は ISO 8601 の UTC 文字列で返す。ボストン時間への変換は画面側で行う
- すべての応答に、最後に収集に成功した時刻 `lastCollectedAt` を含める（画面の「Last updated」と stale 判定に使う）

| パス | パラメータ | 返す内容 |
|---|---|---|
| `GET /api/live/vehicles` | `routes`（カンマ区切り、省略時は全路線） | `vehicles_current` の行（`isStale`: `updated_at` が 3 分以上前か）+ `lastCollectedAt` |
| `GET /api/live/predictions` | `stop`（親駅 ID, 必須） | その親駅に属するホームの `predictions_current` を方向別に並べたもの。始発駅は `departure_time` を使う。`SKIPPED` と、予定時刻が過ぎた便は除く |
| `GET /api/live/alerts` | `routes`、`status`（`active` / `upcoming` / `all`）、`from`、`to` | アラートの一覧。`status` は `active_period` と現在時刻から計算する |
| `GET /api/static/routes` | なし | 路線と路線形状（encoded polyline を GeoJSON に変換済み） |
| `GET /api/static/stops` | `route`（任意） | 親駅の一覧（路線ごと） |
| `GET /api/status` | なし | 直近の `collector_runs`、レート制限の残量、テーブルごとの行数 |
| `GET /api/health` | なし | DB に接続できるか、最後に収集に成功した時刻。Cloud Run のヘルスチェックに使う |

分析用の API は `specs/003-analytics/contracts/analytics-api.md` を参照。
