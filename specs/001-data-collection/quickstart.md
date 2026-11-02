# Quickstart: データ収集をローカルで動かす

ローカル環境の準備、コマンド、環境変数は [docs/development.md](../../docs/development.md) を参照。

```bash
docker compose up -d db && pnpm install && pnpm db:migrate
MBTA_FIXTURE_MODE=1 pnpm job:sync-static
MBTA_FIXTURE_MODE=1 pnpm job:collect
```

## 確認すること

- `vehicles_current` / `predictions_current` / `alerts` に行が入る（運行時間外は車両と予測が 0 件）
- `collector_runs` に `status = success` の行が増え、`ratelimit_remaining` が記録される
- 2 回続けて `pnpm job:collect` を実行すると、`arrival_events` と `prediction_samples` に行が増える
