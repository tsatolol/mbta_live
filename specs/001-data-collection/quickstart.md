# Quickstart: データ収集をローカルで動かす

## 前提

- Node.js Active LTS（24.x）、pnpm、Docker

## 手順

```bash
docker compose up -d db        # ローカル PostgreSQL 16 を起動
pnpm install                   # prisma generate も自動で実行される
pnpm db:migrate                # マイグレーションを適用（prisma migrate deploy）

# フィクスチャで動かす（MBTA API を呼ばない。普段はこちら）
MBTA_FIXTURE_MODE=1 pnpm job:sync-static
MBTA_FIXTURE_MODE=1 pnpm job:collect

# 実 API で動かす（20 req/分の制限を共有するので連打しない）
pnpm job:sync-static
pnpm job:collect

pnpm test                      # Vitest
pnpm fixtures:record           # 実 API からフィクスチャを記録（数リクエスト）
pnpm db:migrate:dev            # スキーマ変更後にマイグレーションを作成（prisma migrate dev）
pnpm db:generate               # Prisma Client を生成
```

## 確認すること

- `vehicles_current` / `predictions_current` / `alerts` に行が入る（運行時間外は車両と予測が 0 件）
- `collector_runs` に `status = success` の行が増え、`ratelimit_remaining` が記録される
- 2 回続けて `pnpm job:collect` を実行すると、`arrival_events` と `prediction_samples` に行が増える

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | ローカル用の接続文字列 |
| `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Cloud Run 用（Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>`。パスワードは Secret Manager から注入） |
| `MBTA_API_BASE_URL` | 既定値 `https://api-v3.mbta.com` |
| `MBTA_API_KEY` | 任意。設定すると `x-api-key` ヘッダーで送る |
| `MBTA_FIXTURE_MODE` | `1` で MBTA API の代わりにフィクスチャを使う |
| `APP_ENV` | `local` / `dev` / `prod`。画面の環境バッジにだけ使う |
| `RAW_RETENTION_DAYS` | 生データの保持日数（dev 3 / prod 28） |

`.env.local` はコミットしない。`.env.example` を最新に保つ。
