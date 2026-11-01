# Quickstart: 分析をローカルで動かす

001 の quickstart でローカル DB を用意し、`pnpm job:collect` を何回か実行して生データを入れてから:

```bash
pnpm job:aggregate                         # 前の運行日を集計
pnpm job:aggregate --from 2026-11-01 --to 2026-11-03   # 期間を指定して再集計
pnpm dev                                   # http://localhost:3000/analytics/headways
pnpm test                                  # 指標の単体テスト
```

## 確認すること

- `aggregate_runs` に `status = success` の行が入る
- `daily_headway_stats` / `daily_prediction_accuracy` / `daily_alert_stats` に行が入る
- `/analytics/headways`, `/analytics/predictions`, `/analytics/alerts`, `/analytics/patterns` にグラフが表示される
- 期間に今日を含めると、今日の分も表示される
