# 契約: 分析の内部 API（Next.js Route Handlers）

- すべて GET、読み取り専用。共通のルールは `specs/002-live-dashboard/contracts/live-api.md` と同じ
- `from` / `to` は運行日（`YYYY-MM-DD`）。範囲に当日が含まれる場合、当日の分は生データから計算して結合する
- 応答には、範囲内で使われた指標の定義の版（`definitionVersions`）を含める
- 期間の既定は今日を含む直近 7 日、最大 92 日。今日より後の `to` は 400。共通の項目は `from` / `to`（実際に使った期間）、`todayIncluded`、`lastAggregatedServiceDate`、`definitionVersions`（`src/lib/api-schemas/analytics.ts`）

| パス | パラメータ | 返す内容 |
|---|---|---|
| `GET /api/analytics/headways` | `route`（`Green` 可。既定は `Red`）, `direction`（0 / 1、省略時は両方向）, `stop`（親駅）, `from`, `to` | 日別（`daily`）・時間帯別（`byHour`。運行日の時間帯の並び）の運行間隔の統計（n・平均・p50・p90・最大・団子運転・間隔の開き）、合計（`totals`）、期間内にデータのある駅の一覧（`stops`）。日別・時間帯別の p50 / p90 は、元の行を件数で重み付けした平均（近似） |
| `GET /api/analytics/predictions` | `route`（省略時はすべての路線。`Green` は不可）, `direction`, `updateType`（`MID_TRIP` / `AT_TERMINAL` / `REVERSE_TRIP` / `UNKNOWN`）, `from`, `to` | リード時間ごと（`byLead`、短い順）・予測の種類ごと（`byUpdateType`）・日別（`daily`）の誤差の統計（n・平均誤差・平均絶対誤差・p90 絶対誤差・±60 秒以内の割合）と合計（`totals`。データがなければ null）。まとめた p90 は件数で重み付けした平均（近似） |
| `GET /api/analytics/alerts` | `route`（省略時はすべての路線。`Green` は不可）, `from`, `to` | 日別の遅延系・お知らせ系の件数（alert-days）と分数（`daily`。集計済みの運行日と今日だけ）、effect ごと（区分付き）・cause ごとの内訳（分数の多い順）、区分ごとの合計（`totals`）。すべての路線のときは `route_id = All` の行を読む |
| `GET /api/analytics/heatmap` | `metric`（`headway_p90` / `prediction_abs_error` / `alert_minutes`）, `route`, `from`, `to` | 曜日 × 時間帯（ET）の行列 |
