# Contract: MBTA V3 API の利用

収集ジョブ（collector / sync-static）が MBTA V3 API をどう呼び、応答をどう解釈するかの約束事。応答の性質は 2026-11-01 に実 API で確認した。

## 共通

- Base URL: `https://api-v3.mbta.com`（環境変数 `MBTA_API_BASE_URL` で上書き可）
- 形式: JSON:API（`data[].attributes`, `data[].relationships`, `included`）
- 認証: `MBTA_API_KEY` が設定されていれば `x-api-key` ヘッダーで送る。キーありの上限は 1000 req/分、キーなしは送信元 IP 単位で 20 req/分
- レート制限ヘッダー（実測で確認）: `x-ratelimit-limit: 20`、`x-ratelimit-remaining`、`x-ratelimit-reset`（UNIX 秒。次の分の境界）。値はログと `collector_runs` に残す
  - 連続したリクエストで `remaining` が 19→18→17→19→16→19→15 と増減した（サーバーごとに数えている模様）。`remaining` を当てにせず、下の予算を自前で守る
- 応答には `last-modified` ヘッダーが付く。応答は `Accept-Encoding` に応じて圧縮される（curl では zstd が返った）。サイズは圧縮後の転送量で見積もる
- `fields[...]`（sparse fieldsets）で必要な属性だけを取る
- 応答は必ず zod でパースする。スキーマに合わない行はスキップしてログに残す
- 429 を受けたらリトライせずに終了する

## リクエスト予算

1 環境あたり**常に 5 req/分以下**。

| ジョブ | エンドポイント | 頻度 | パラメータ |
|---|---|---|---|
| collector | `GET /vehicles` | 毎分（dev 5 分） | `filter[route]=Red,Mattapan,Orange,Blue,Green-B,Green-C,Green-D,Green-E` |
| collector | `GET /predictions` | 毎分（dev 5 分） | `filter[route]=<同上>`（predictions は stop / route / trip / 位置のいずれかでのフィルタが必須） |
| collector | `GET /alerts` | 毎分（dev 5 分） | `filter[route]=<同上>`（`filter[route_type]=0,1` でも同じ結果になることを確認済み） |
| sync-static | `GET /routes` | 毎日 | `filter[type]=0,1` |
| sync-static | `GET /stops` ① | 毎日 | `filter[route_type]=0,1&include=parent_station` |
| sync-static | `GET /stops` ② | 毎日 | `filter[id]=<①で得た親駅 125 件>&include=child_stops` |
| sync-static | `GET /stops` ③ | 必要なときだけ | `filter[id]=<unknown_stop_ids の未解決分>` |
| sync-static | `GET /route_patterns` | 毎日 | `filter[route]=<同上>&include=representative_trip.shape,representative_trip.stops&fields[stop]=name,parent_station` |

collector は 1 回あたり 3 リクエスト、sync-static は 1 日あたり 4〜5 リクエスト。ローカル開発も同じ IP 制限を共有するので、普段は `MBTA_FIXTURE_MODE=1` でフィクスチャを使う。

## 応答の性質（実測）

### `/routes`

- `color` は Red と Mattapan が `DA291C`、Green 4 支線はすべて `00843D`、Orange が `ED8B00`、Blue が `003DA5`。色はコードに直接書かず、この値を使う
- `direction_names`: Red / Orange は `South / North`、Green / Blue は `West / East`、Mattapan は `Outbound / Inbound`。`direction_destinations` もある（例: Green-D は `Riverside / Union Square`）
- route_type: `0` = Light Rail（Green 各支線, Mattapan）、`1` = Heavy Rail（Red, Orange, Blue）

### `/stops`

- ① の `data` にはホーム（`location_type=0`）だけが 265 件入る。親駅（`location_type=1`, `place-xxxx`）は `included` にだけ入る（125 件）。すべてのホームに親駅がある。`filter[location_type]` は不要
- **終点駅の番線などの 12 件は ① に含まれない**: `Alewife-01/02`, `Braintree-01/02`, `Forest Hills-01/02`, `Oak Grove-01/02`, `Union Square-01/02`, `Government Center-Brattle`, `71199`。車両と予測の `stop` には実際にこれらが出てくる
- ② で親駅の `child_stops` を取ると 2,567 件（バス停・通勤鉄道・出入口などを含む）が返る。`location_type=0` かつ `vehicle_type` が 0 / 1 のものだけを残すと、上の 12 件が補える（圧縮後 約 140KB）
- それでも駅一覧にない ID を collector が見つけたら `unknown_stop_ids` に記録し、次の同期で ③ を使って取得する

### `/route_patterns`

- 対象路線で絞っても、臨時の代行バス路線（`Shuttle-*`, `typicality=4`）のパターンが混ざる。`route_id` が対象 8 路線のものだけを残す
- 通常運行は `typicality=1`（`canonical=true`）の 18 件。Red は方向ごとに Ashmont 行きと Braintree 行きの 2 パターンがある
- 停車順は `representative_trip.stops`（ホームの ID）、形状は `shape.polyline`（encoded polyline）。1 回で全路線分が取れる（圧縮後 約 23KB）

### `/alerts`

- フィードには `lifecycle=UPCOMING`（まだ始まっていない予告）も含まれる。現在有効かどうかは `active_period` で判定する（`end` は `null` のことがある）
- `informed_entity` の要素: `route`, `route_type`, `stop`（ホームと親駅の両方が出る）, `direction_id`（ないこともある）, `activities`
- `header` のほかに `short_header`, `service_effect`, `timeframe`, `severity`（整数）などがある
- 観測した値（15 件）: effect = `NOTICE`, `STATION_ISSUE`, `STATION_CLOSURE`, `SUSPENSION`, `SHUTTLE`, `DELAY`／cause = `UNKNOWN_CAUSE`, `MAINTENANCE`, `CONSTRUCTION`, `SINGLE_TRACKING`／severity = 1, 3, 4, 7／lifecycle = `NEW`, `ONGOING`, `UPCOMING`

### `/predictions`

- 日曜 05:48 ET（運行中の車両 23 両）の時点で 416 件、非圧縮 251KB / 圧縮後 10KB。平日の日中はこの数倍になる見込み（平日ピークの実測は未実施）
- 始発駅では `arrival_time` が `null` で、`departure_time` だけが入る
- `schedule_relationship`: `null`（時刻表どおり）, `ADDED`（時刻表にない便）, `CANCELLED`（到着・出発時刻がどちらも `null`）, `SKIPPED`
- `update_type` と不確かさ（`arrival_uncertainty` / `departure_uncertainty`、秒）が対応している: `MID_TRIP` = 60, `AT_TERMINAL` = 120, `REVERSE_TRIP`（終点で折り返した後の次の便）= 360
- `status` はほぼ `null`。`trip_headsign` は `null`。`last_trip`, `revenue` もある
- 便 ID には `ADDED-…` や `NONREV-…` で始まる、時刻表（GTFS）にない ID が多い

### `/vehicles`

- 属性: `bearing`, `current_status`（`INCOMING_AT` / `STOPPED_AT` / `IN_TRANSIT_TO`）, `current_stop_sequence`, `direction_id`, `label`, `latitude`, `longitude`, `revenue`, `speed`, `occupancy_status`, `carriages[]`（車両ごとの `label` / `occupancy_status` / `occupancy_percentage`）, `updated_at`。リレーションは `route`, `stop`, `trip`
- `stop` が `null` の車両がある
- `updated_at` が 25〜30 分前のまま更新されていない車両がある（終点で待機中の Red Line の 2 両）
- `speed` が入るのは Green と Mattapan だけ。`occupancy_status` は `null`、`carriages[].occupancy_status` は `NO_DATA_AVAILABLE`
- 車両 ID は `R-…`, `O-…`, `G-…` の形式

### 日時

- `2026-11-01T05:23:46-05:00` のようなオフセット付き文字列（夏時間の間は `-04:00`）。必ずオフセットを考慮してパースする
