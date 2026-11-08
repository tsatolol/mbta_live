# 開発ガイド — mbta_live

ローカル開発の手順と環境変数。feature ごとの確認手順は各 feature の `quickstart.md` を参照。

## 前提

- Node.js Active LTS（24.x。`.nvmrc` あり）、pnpm、Docker、Terraform 1.17（インフラを触るとき）（ローカルの PostgreSQL 16 に使う。Docker がなければ、PostgreSQL 16 を直接起動して `DATABASE_URL` と `TEST_DATABASE_URL` を向けてもよい）

## コマンド

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
pnpm job:aggregate --from 2026-11-01 --to 2026-11-03   # 期間を指定して再集計（生データが残っている範囲。今日以降は不可、一度に 92 日まで）

pnpm lint && pnpm typecheck && pnpm test   # PR を出す前に実行（PR では軽いチェックだけが走る）
pnpm test:unit                 # 純粋関数
pnpm test:integration          # 本物の PostgreSQL を使うテスト（docker compose の DB）
pnpm test:replay               # 記録した連続ポーリングを collector に流すテスト
pnpm test:e2e                  # Playwright（E2E 用の DB を作り直し、本番と同じビルドを APP_ENV=dev で起動する）
pnpm e2e:seed [--migrate] base # E2E 用の DB にシードだけ入れる（シナリオ: base / stale-collection / out-of-service / analytics）
pnpm test:smoke                # デプロイ後のスモークテスト（SMOKE_BASE_URL と SMOKE_ID_TOKEN が必要。パイプラインが実行する）
pnpm exec playwright test -c playwright.dev.config.ts  # dev での E2E（DEV_BASE_URL と DEV_ID_TOKEN が必要。普段は scripts/dev-e2e.sh から）
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
scripts/dev-e2e.sh <URL>                                  # IAP を通した dev での E2E（読み取りだけ。条件は smoke.sh と同じ。Chromium が必要）
```

## 過去の運行日を dev / prod で集計し直す

集計の定義を変えたとき（`AGGREGATE_DEFINITION_VERSION` を上げたとき）や、集計に失敗した日があるときは、aggregate の Cloud Run Job を引数付きで実行する。`--args` は引数を丸ごと置き換えるので、先頭に `jobs/aggregate.mjs` を付ける。

```bash
gcloud run jobs execute aggregate --project=<プロジェクト ID> --region=us-east4 \
  --args=jobs/aggregate.mjs,--from,2026-11-01,--to,2026-11-03 --wait
```

同じ日を何度集計しても結果は同じ。生データが残っていない日（prod 28 日 / dev 3 日より前）は、0 行で集計済みになるので指定しない。

## 分析 API の性能を測る

```bash
pnpm tsx --conditions=react-server tests/perf/analytics-perf.ts   # prod 規模のデータ（28 日分）で各 API を測る（PERF_DATABASE_URL の DB を作り直す）
```

## MBTA API を呼ぶときの注意

- dev / prod のジョブはキーありで呼ぶ（Secret Manager の `MBTA_API_KEY`）。ローカルは普段キーなしで、上限は送信元 IP 単位で 20 req/分
- 普段は `MBTA_FIXTURE_MODE=1` でフィクスチャを使い、実 API は手動で数回実行する程度にとどめる
- テスト（CI を含む）では実 API を呼ばない

## 環境変数

| 変数                                                            | 用途                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                  | ローカル用の接続文字列                                                                                                                       |
| `TEST_DATABASE_URL`                                             | 結合テスト・再生テスト用の DB（既定値 `postgresql://postgres:postgres@localhost:5432/mbta_live_test`）。テストの開始時に中身を消して作り直す |
| `E2E_DATABASE_URL`                                              | E2E 用の DB（既定値 `postgresql://postgres:postgres@localhost:5432/mbta_live_e2e`）。E2E の開始時に作り直す                                  |
| `TEST_SKIP_MIGRATE`                                             | `1` で、テストの開始時に DB を作り直さない（マイグレーションの互換性テスト用。普段は設定しない）                                             |
| `SMOKE_BASE_URL`, `SMOKE_ID_TOKEN`                              | スモークテストの対象の URL と、IAP を通るための ID トークン（パイプラインが渡す）                                                            |
| `DEV_BASE_URL`, `DEV_ID_TOKEN`                                  | dev E2E の対象 URL と IAP 用 ID トークン。`scripts/dev-e2e.sh` が取得する。認証情報を記録しないため trace・video は無効                      |
| `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Cloud Run 用（Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>`。パスワードは Secret Manager から注入）                                   |
| `MBTA_API_BASE_URL`                                             | 既定値 `https://api-v3.mbta.com`                                                                                                             |
| `MBTA_API_KEY`                                                  | 任意。設定すると `x-api-key` ヘッダーで送る                                                                                                  |
| `MBTA_FIXTURE_MODE`                                             | `1` で MBTA API の代わりにフィクスチャを使う                                                                                                 |
| `APP_ENV`                                                       | `local` / `dev` / `prod`。画面の環境バッジにだけ使う                                                                                         |
| `RAW_RETENTION_DAYS`                                            | 生データの保持日数（dev 3 / prod 28）                                                                                                        |

`.env.local` はコミットしない。`.env.example` を最新に保つ。

## 画面とアクセシビリティを確認する

```bash
pnpm exec playwright test tests/e2e/a11y.spec.ts tests/e2e/design-final.spec.ts
```

前者は明暗の WCAG 2.2 AA、後者はヒートマップの配色、色覚シミュレーション、forced-colors、320px の横はみ出しを調べる。forced-colors は実際の描画色と操作・意味を検査し、通常の明暗で行う axe と区別する。

目視確認は E2E 専用 DB に analytics をシードして本番ビルドを起動し、Playwright で撮影する。手順と9画面の確認項目は `specs/005-ui-design/quickstart.md`。PC 1280×860 とスマホ390×844、明暗の4通りを確認する。例（起動済みのローカル画面）:

```js
// node --input-type=module で実行
import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
});
await page.goto("http://localhost:3200/analytics/headways");
await page.getByTestId("analytics-summary").waitFor();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "/tmp/headways-mobile-dark.png", fullPage: true });
await browser.close();
```

グラフは描画の完了を待ち、地図は実タイルが読み込まれたことも確認する。ネットワーク制限のある環境ではプロキシ・CA の設定を使い、スタブの地図を実タイル確認の証拠にしない。画像による自動差分比較は行わない。

デプロイ後は `scripts/dev-e2e.sh <dev URL>` で暗い主要画面・実際の Dark タイル・明暗それぞれの初回表示3秒以内を検査する。測定はウォームアップ後の新しいページで行い、結果を JSON に添付する。IAP のトークンは同一オリジンだけに付け、ログや trace に残さない。prod 承認は CI と dev テストの成功後。デプロイ後に dev / prod の明暗切り替え・保存とスマホ表示を目視で確認し、ローカル測定と区別して記録する。

## パイプラインとロールバック

- PR を作ると `pr-checks`、main にマージするとリリース用のパイプライン（ci → dev へのデプロイ → 承認 → prod へのデプロイ）が動く。流れと安全装置は `specs/004-infra-cicd/contracts/pipeline.md`
- ロールバックは GitHub の Actions の画面から `rollback` を実行する（環境と、必要ならイメージのダイジェストを指定。prod は承認が要る）
- bootstrap（GCP プロジェクト、WIF、GitHub の設定、IAP の OAuth クライアント、予算）の変更は、ローカルで `terraform plan` を確かめてから apply する（`specs/004-infra-cicd/quickstart.md`）
