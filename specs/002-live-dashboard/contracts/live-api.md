# 契約: リアルタイム画面の内部 API（Next.js Route Handlers）

- すべて GET、読み取り専用。DB だけを読み、MBTA API は呼ばない
- クエリパラメータは zod で検証し、不正な値には `400 { "error": string }` を返す
- 時刻は ISO 8601 の UTC 文字列で返す。ボストン時間への変換は画面側で行う
- すべての応答に、最後に収集に成功した時刻 `lastCollectedAt` と、応答を作った時刻 `generatedAt` を含める（画面の「Last updated」と stale 判定に使う）
- 応答の型の正は `src/lib/api-schemas/`（vehicles、predictions、alerts、routes、stops、status）。Route Handler は返す前にこのスキーマで確かめる（`src/lib/api/handler.ts`）

| パス | パラメータ | 返す内容 |
|---|---|---|
| `GET /api/live/vehicles` | `routes`（カンマ区切り、省略時は全路線） | `vehicles_current` の行（`isStale`: `updated_at` が 3 分以上前か）+ `lastCollectedAt` |
| `GET /api/live/predictions` | `stop`（親駅 ID, 必須） | その親駅に属するホームの `predictions_current` を路線・方向別に次の 3 本。始発駅は `departure_time` を使う。`SKIPPED` と、予定時刻が過ぎた便、時刻のない便は除く。運休の便は `cancelled`。その駅と路線に有効なアラートも返す。親駅でなければ 404 |
| `GET /api/live/alerts` | `routes`、`status`（`active` / `upcoming` / `all`。既定は `active`）、`effects`（カンマ区切り）、`from`、`to`（運行日 `YYYY-MM-DD`） | アラートの一覧（重要度の高い順、最大 200 件。超えたら `truncated`）。`status` は `active_period` と現在時刻から計算する。`all` はフィードから消えた過去のアラートも含む。`from` / `to` はその期間に有効だったもの |
| `GET /api/static/routes` | なし | 路線と路線形状（encoded polyline を GeoJSON に変換済み） |
| `GET /api/static/stops` | `route`（任意） | 親駅の一覧（路線ごと） |
| `GET /api/status` | なし | 直近の `collector_runs`、レート制限の残量、テーブルごとの行数 |
| `GET /api/health` | なし | DB に接続できるか、最後に収集に成功した時刻、前の運行日の集計が成功しているか。Cloud Run の起動確認、スモークテスト、監視に使う。DB に接続できなければ 503。004 で先に作った（応答の型は `src/lib/api-schemas/health.ts`） |

## 読むテーブル

この feature は新しいテーブルを作らない。001 のテーブル（`specs/001-data-collection/data-model.md`）を読む。

| 画面 | テーブル |
|---|---|
| Live Map | `vehicles_current`, `routes`, `route_patterns`（形状）, `stops` |
| Stations / Arrival Board | `stops`, `route_patterns`（停車順）, `predictions_current`, `alerts`, `alert_routes` |
| Alerts | `alerts`, `alert_routes` |
| System Status | `collector_runs`, 各テーブルの行数 |

## 計算して返す値

- **`isStale`（車両）**: `now - updated_at >= 3 分`
- **アラートの状態**: `active_period` のいずれかの区間に現在時刻が入っていれば `active`、すべての区間が未来なら `upcoming`、それ以外は `past`。フィードから消えたアラート（`in_feed = false`）は `past` とし、区間は最後に見た時刻（`last_seen_at`）で終わらせる
- **あと何分か**: API は `arrival_time`（始発駅は `departure_time`）を返し、ブラウザが毎秒 `時刻 - 現在時刻` を計算する
- **stale バナー**: 最後に成功した `collector_runs.finished_at` から 3 分以上経っているか（`lastCollectedAt` から画面で判定）

`now` はサーバーの時計（`src/lib/clock.ts`）から取り、テストでは固定する。

## 応答の型

応答の型は zod スキーマとして `src/lib/api-schemas/` に定義し、Route Handler（応答を組み立てる側）と画面（受け取る側）の両方で使う。結合テストでは、実際の応答がこのスキーマで解析できることを確かめる。

分析用の API は `specs/003-analytics/contracts/analytics-api.md` を参照。
