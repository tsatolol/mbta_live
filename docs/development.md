# 開発ガイド — mbta_live

ローカル開発の手順と環境変数。feature ごとの確認手順は各 feature の `quickstart.md` を参照。

## 前提

- Node.js Active LTS（24.x）、pnpm、Docker

## コマンド（予定）

```bash
docker compose up -d db        # ローカル PostgreSQL 16
pnpm install                   # prisma generate も自動で実行される
pnpm db:migrate                # マイグレーションを適用（prisma migrate deploy）
pnpm db:migrate:dev            # スキーマ変更後にマイグレーションを作成（prisma migrate dev）
pnpm db:generate               # Prisma Client を生成
pnpm dev                       # http://localhost:3000

pnpm job:sync-static           # 静的データの同期
pnpm job:collect               # collector を 1 回
pnpm job:aggregate             # 前の運行日を集計
pnpm job:aggregate --from 2026-11-01 --to 2026-11-03   # 期間を指定して再集計

pnpm lint && pnpm typecheck && pnpm test   # PR を出す前に実行（PR では軽いチェックだけが走る）
pnpm test:unit                 # 純粋関数
pnpm test:integration          # 本物の PostgreSQL を使うテスト（docker compose の DB）
pnpm test:replay               # 記録した連続ポーリングを collector に流すテスト
pnpm test:e2e                  # Playwright
pnpm fixtures:record           # 実 API から 1 回分のフィクスチャを記録（数リクエスト）
pnpm fixtures:record-sequence  # 実 API から連続ポーリングを記録（再生テスト用。1 分ごとに 3 リクエスト）
```

`pnpm test` は unit + integration + replay を実行する。

## MBTA API を呼ぶときの注意

- キーなしの上限は送信元 IP 単位で 20 req/分。ローカルも同じ制限を共有する
- 普段は `MBTA_FIXTURE_MODE=1` でフィクスチャを使い、実 API は手動で数回実行する程度にとどめる
- テスト（CI を含む）では実 API を呼ばない

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
