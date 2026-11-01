# Contract: 分析の内部 API（Next.js Route Handlers）

- すべて GET、読み取り専用。共通のルールは `specs/002-live-dashboard/contracts/live-api.md` と同じ
- `from` / `to` は運行日（`YYYY-MM-DD`）。範囲に当日が含まれる場合、当日の分は生データから計算して結合する
- 応答には、範囲内で使われた指標の定義の版（`definitionVersions`）を含める

| パス | パラメータ | 返す内容 |
|---|---|---|
| `GET /api/analytics/headways` | `route`（`Green` 可）, `direction`, `stop`, `from`, `to` | 日別・時間帯別の運行間隔の統計、団子運転と間隔の開きの件数 |
| `GET /api/analytics/predictions` | `route`, `direction`, `updateType`, `from`, `to` | リード時間のバケットごとの誤差の統計 |
| `GET /api/analytics/alerts` | `route`, `from`, `to` | 日別の effect × cause の件数と継続時間（遅延系／お知らせ系の区分付き） |
| `GET /api/analytics/heatmap` | `metric`（`headway_p90` / `prediction_abs_error` / `alert_minutes`）, `route`, `from`, `to` | 曜日 × 時間帯（ET）の行列 |
