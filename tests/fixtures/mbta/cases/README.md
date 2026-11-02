# 特殊ケースのフィクスチャ

`pnpm fixtures:cases`（`scripts/build-case-fixtures.ts`）で、記録済みのフィクスチャから特殊ケースの行だけを抜き出して作る。各ファイルの `meta` に、元のファイル（`source`）、記録時刻（`recordedAt`、UTC）、説明（`note`）がある。

| ファイル | 内容 |
|---|---|
| `vehicles-off-hours.json` / `predictions-off-hours.json` | 運行時間外の空の応答 |
| `vehicles-stop-null.json` | `stop` が `null` の車両 |
| `vehicles-stale.json` | `updated_at` が記録時刻より 180 秒以上前の車両（終点で待機中） |
| `vehicles-terminal-track.json` | `stop` が終点の番線 ID（`Alewife-01` など） |
| `vehicles-malformed.json` | **合成データ**: 正しい行 2 件 + `latitude` が文字列の行 + `id` のない行 |
| `alerts-upcoming.json` | `lifecycle` が `UPCOMING` のアラート |
| `predictions-cancelled.json` | `schedule_relationship` が `CANCELLED`（到着・出発時刻がどちらも `null`） |
| `predictions-skipped.json` | `schedule_relationship` が `SKIPPED` |
| `predictions-origin.json` | 始発駅の予測（`arrival_time` が `null`） |
| `route-patterns-shuttle.json` | 臨時の代行バス路線（`Shuttle-*`）のパターンと、関係する trip / shape |

`vehicles-malformed.json` 以外は、実 API の応答の行をそのまま使っている。
