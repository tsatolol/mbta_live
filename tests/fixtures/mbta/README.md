# MBTA V3 API のフィクスチャ

実 API（`https://api-v3.mbta.com`、API キーなし）から取得した応答をそのまま保存したもの。テストではこれらを使い、実 API は呼ばない。

ファイル名の時刻はボストン時間（ET）。2026-11-01（日曜）は夏時間の終了日で、取得時は EST（UTC−5）。2026-11-02 以降のファイルは `pnpm fixtures:record`（`scripts/record-fixtures.ts`）で記録した。`/routes` と `/route_patterns` は 11-02 の応答が 11-01 と完全に同じだったので、11-01 のものだけを置いている。

フィクスチャモード（`MBTA_FIXTURE_MODE=1`）では、接頭辞ごとに最も新しいファイルが使われる。

| ファイル | リクエスト | 取得時の状況 |
|---|---|---|
| `vehicles-20261101-0421.json` | `GET /vehicles?filter[route]=Red,Mattapan,Orange,Blue,Green-B,Green-C,Green-D,Green-E` | 運行時間外。`data` が空 |
| `predictions-20261101-0422.json` | `GET /predictions?filter[route]=<同上>` | 運行時間外。`data` が空 |
| `alerts-20261101-0422.json` | `GET /alerts?filter[route]=<同上>` | 15 件。`UPCOMING` を含む |
| `routes-20261101-0422.json` | `GET /routes?filter[type]=0,1` | 8 路線 |
| `stops-route-type-20261101-0422.json` | `GET /stops?filter[route_type]=0,1&include=parent_station` | ホーム 265 件（`data`）、親駅 125 件（`included`） |
| `route-patterns-20261101-0423.json` | `GET /route_patterns?filter[route]=<同上>&include=representative_trip.shape,representative_trip.stops&fields[stop]=name,parent_station` | 43 件。`Shuttle-*`（`typicality=4`）を含む |
| `vehicles-20261101-0548.json` | `GET /vehicles?filter[route]=<同上>` | 始発直後。23 両。`updated_at` が約 30 分前の車両、`stop` が `null` の車両、終点の番線 ID（`Alewife-01` など）を含む |
| `predictions-20261101-0548.json` | `GET /predictions?filter[route]=<同上>` | 416 件。`CANCELLED` / `SKIPPED` / `ADDED`、始発駅（`arrival_time` が `null`）、`REVERSE_TRIP` を含む |
| `stops-child-stops-20261101-0549.json` | `GET /stops?filter[id]=<親駅 125 件>&include=child_stops` | `included` に 2,567 件（バス停・出入口などを含む） |
| `stops-by-id-20261101-0549.json` | `GET /stops?filter[id]=Alewife-01,Forest Hills-02,Oak Grove-02` | 終点の番線 3 件 |
| `vehicles-20261102-1020.json` | `GET /vehicles?filter[route]=<同上>` | 平日（月曜）の日中。106 両 |
| `predictions-20261102-1020.json` | `GET /predictions?filter[route]=<同上>` | 平日の日中。2,278 件（非圧縮 1.36MB）。`SKIPPED` 32 件、`CANCELLED` 25 件、`ADDED` 81 件 |
| `alerts-20261102-1020.json` | `GET /alerts?filter[route]=<同上>` | 平日の日中。12 件（`UPCOMING` 3 件） |
| `stops-route-type-20261102-1020.json` | `GET /stops?filter[route_type]=0,1&include=parent_station` | 平日の日中。件数は日曜と同じで、中身の一部が違う |
| `stops-child-stops-20261102-1020.json` | `GET /stops?filter[id]=<親駅 125 件>&include=child_stops` | 平日の日中。中身の一部が日曜と違う |

応答の性質のまとめは `specs/001-data-collection/contracts/mbta-api.md` を参照。特殊ケースだけを抜き出したフィクスチャは `cases/` にある（`cases/README.md`）。

## 連続ポーリングの記録（`sequences/`）

`pnpm fixtures:record-sequence --count N`（`scripts/record-sequence.ts`）で、collector と同じ 3 リクエストを 60 秒ごとに記録したもの。容量を抑えるため、各応答は gzip で圧縮している（`<NNN>-<endpoint>.json.gz`）。`index.json` に各回の記録時刻（`polledAt`、UTC）がある。

| ディレクトリ | 内容 |
|---|---|
| `sequences/20261102-1228/` | 平日（月曜）12:28 ET から 4 回分。到着検出の結合テスト（`tests/integration/collect-arrivals.test.ts`）で使う |

