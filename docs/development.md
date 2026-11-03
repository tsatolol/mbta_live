# 開発ガイド — mbta_live

ローカル開発の手順と環境変数。feature ごとの確認手順は各 feature の `quickstart.md` を参照。

## 前提

- Node.js Active LTS（24.x。`.nvmrc` あり）、pnpm、Docker、Terraform 1.17（インフラを触るとき）（ローカルの PostgreSQL 16 に使う。Docker がなければ、PostgreSQL 16 を直接起動して `DATABASE_URL` と `TEST_DATABASE_URL` を向けてもよい）

## コマンド（予定）

```bash
docker compose up -d db        # ローカル PostgreSQL 16
pnpm install                   # prisma generate も自動で実行される
pnpm db:migrate                # マイグレーションを適用（prisma migrate deploy）
pnpm db:migrate:dev            # スキーマ変更後にマイグレーションを作成（prisma migrate dev）
pnpm db:generate               # Prisma Client を生成
pnpm dev                       # http://localhost:3000
pnpm build                     # Next.js のビルド（standalone）
pnpm build:jobs                # ジョブを dist/jobs/*.mjs にまとめる（イメージ用）
docker build -t mbta-live .    # web とジョブ共通のイメージ（起動コマンドは docs/architecture.md）

pnpm job:sync-static           # 静的データの同期
pnpm job:collect               # collector を 1 回
pnpm job:aggregate             # 前の運行日を集計
pnpm job:aggregate --from 2026-11-01 --to 2026-11-03   # 期間を指定して再集計

pnpm lint && pnpm typecheck && pnpm test   # PR を出す前に実行（PR では軽いチェックだけが走る）
pnpm test:unit                 # 純粋関数
pnpm test:integration          # 本物の PostgreSQL を使うテスト（docker compose の DB）
pnpm test:replay               # 記録した連続ポーリングを collector に流すテスト
pnpm test:e2e                  # Playwright
pnpm test:smoke                # デプロイ後のスモークテスト（SMOKE_BASE_URL と SMOKE_ID_TOKEN が必要。パイプラインが実行する）
pnpm fixtures:record           # 実 API から 1 回分のフィクスチャを記録（7 リクエスト）
pnpm fixtures:cases            # 記録済みのフィクスチャから特殊ケースのフィクスチャを作る（API は呼ばない）
pnpm fixtures:record-sequence  # 実 API から連続ポーリングを記録（再生テスト用。1 分ごとに 3 リクエスト）

pnpm infra:fmt                 # Terraform の書式の検査（terraform fmt -check）
pnpm infra:validate            # Terraform の各ディレクトリで init（backend なし）と validate
```

`pnpm test` は unit + integration + replay を実行する（smoke は含まない）。

リリース用のパイプラインが使うスクリプト（手元でも実行できる）:

```bash
scripts/check-container.sh <イメージ> <DATABASE_URL>      # コンテナの起動確認（Docker が必要）
scripts/check-migration-compat.sh <DATABASE_URL>          # マイグレーションの互換性テスト（PROD_SHA で比べるコミットを指定できる）
scripts/plan-summary.sh <plan の JSON> / scripts/plan-hash.sh <plan の JSON>
scripts/smoke.sh <URL>                                    # IAP を通したスモークテスト（SMOKE_TESTER_SA と IAP_CLIENT_ID、deployer の gcloud の認証が必要）
```

## MBTA API を呼ぶときの注意

- キーなしの上限は送信元 IP 単位で 20 req/分。ローカルも同じ制限を共有する
- 普段は `MBTA_FIXTURE_MODE=1` でフィクスチャを使い、実 API は手動で数回実行する程度にとどめる
- テスト（CI を含む）では実 API を呼ばない

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | ローカル用の接続文字列 |
| `TEST_DATABASE_URL` | 結合テスト・再生テスト用の DB（既定値 `postgresql://postgres:postgres@localhost:5432/mbta_live_test`）。テストの開始時に中身を消して作り直す |
| `TEST_SKIP_MIGRATE` | `1` で、テストの開始時に DB を作り直さない（マイグレーションの互換性テスト用。普段は設定しない） |
| `SMOKE_BASE_URL`, `SMOKE_ID_TOKEN` | スモークテストの対象の URL と、IAP を通るための ID トークン（パイプラインが渡す） |
| `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Cloud Run 用（Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>`。パスワードは Secret Manager から注入） |
| `MBTA_API_BASE_URL` | 既定値 `https://api-v3.mbta.com` |
| `MBTA_API_KEY` | 任意。設定すると `x-api-key` ヘッダーで送る |
| `MBTA_FIXTURE_MODE` | `1` で MBTA API の代わりにフィクスチャを使う |
| `APP_ENV` | `local` / `dev` / `prod`。画面の環境バッジにだけ使う |
| `RAW_RETENTION_DAYS` | 生データの保持日数（dev 3 / prod 28） |

`.env.local` はコミットしない。`.env.example` を最新に保つ。
