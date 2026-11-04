# 調査と決定: リアルタイム画面

## 画面の更新方式: 自前 API のポーリング

- **決定**: ブラウザは自前の API を TanStack Query の `refetchInterval` でポーリングする（地図 15 秒、駅 30 秒）。API は DB の最新の状態を返す
- **理由**: 収集が 1 分間隔なので、サーバーからのプッシュ（SSE）にしても鮮度はほとんど変わらない。閲覧者が増えても MBTA API へのリクエスト数は変わらない
- **検討した代替案**: SSE でサーバーから配信（Cloud Run で長時間接続を管理する必要があり、効果が小さい）

## 地図: MapLibre GL JS + OpenFreeMap

- **決定**: MapLibre GL JS と OpenFreeMap の `positron` スタイル（淡色）
- **理由**: 無料で API キーが不要。路線形状の描画と車両アイコンの回転を扱いやすい。淡色の地図で路線色が目立つ
- **検討した代替案**: Leaflet + OSM（ベクタータイルや滑らかな描画が苦手）、Google Maps JS API（API キーと従量課金が必要）

## UI

- **決定**: Tailwind CSS + shadcn/ui。画面は英語、時刻はボストン時間
- **理由**: 少ない手間で一貫した見た目にできる

## 認証

- **決定**: IAP で許可したユーザーだけに制限する（設定は `specs/004-infra-cicd/`）。アプリ側にログイン機能は作らない
- **理由**: 利用者が少数で固定。アプリにユーザー管理を持たずに済む

## 出典表記

- **決定**: フッターに `Data provided by MBTA` と `© OpenFreeMap © OpenStreetMap contributors` を出す
- **理由**: MBTA の開発者向け利用規約と OSM のライセンス表記のため

## フェーズ 1〜2 の実装で決めたこと（2026-11-04）

### 依存のバージョン

- 2 週間以上前に出た最新の安定版に固定した: `maplibre-gl` 6.15.0、`@tanstack/react-query` 5.104.5、`tailwindcss` / `@tailwindcss/postcss` 4.3.3、`clsx` 2.1.1、`tailwind-merge` 3.7.0、`class-variance-authority` 0.7.1
- `@playwright/test` は 1.63.0（最新は 1.64.1）。開発環境に入っている Playwright のブラウザ（1.63 用）をそのまま使うため。CI ではブラウザを入れて使う（T033）
- shadcn/ui は CLI（`npx shadcn`）を使わず、`components.json` と、使う部品（Badge、Card、Input）を同じ形で手で置いた。外部のスクリプトを実行しないため。部品を足すときも同じようにする

### E2E のデータの用意

- **決定**: 001 のフィクスチャ（平日 10:20 ET の記録）を、本番と同じ collector の処理（`runCollect`）で E2E 用の DB に取り込み、そのあと時刻（車両・予測・アラートの期間・collector_runs）を「今」に合わせてずらす（`tests/e2e/seed-db.ts`）
- **理由**: アプリの時計（`src/lib/clock.ts`）を E2E のために偽装しなくて済む。取り込みは本番と同じ処理なので、テスト用の取り込み処理を別に持たずに済む
- シードは server-only のコードを使うので、Playwright のプロセスではなく `tsx --conditions=react-server` の別プロセスで実行する（`tests/e2e/helpers/seed.ts`）。シナリオ（`base`、`stale-collection`、`out-of-service`）を切り替えるテストがあるので、E2E は 1 つのワーカーで順に動かす
- `base` では、更新の止まった車両（ID が最も小さい車両の `updated_at` を 5 分前に）と、Park Street の運休・通過の便を作る。フィクスチャ自体にも運休（26 件）と通過（33 件）の予測が含まれていた
- E2E 用の DB は `E2E_DATABASE_URL`（既定 `mbta_live_e2e`）。開発用・テスト用の DB とは別

### 共通のレイアウト

- ヘッダーの最終更新時刻と stale の判定は、004 で作った `/api/health` の `lastCollectedAt` を 30 秒ごとに取得して使う。stale の判定は 5 秒ごとに現在時刻を進めて行う（データの取得を待たずにバナーを出すため）
- 環境バッジ（`APP_ENV`）を実行時に読むため、ルートの layout を `force-dynamic` にした（ビルド時に静的化すると、ビルドしたときの環境変数が埋め込まれ、イメージを 1 つにできない）。画面のデータはブラウザから内部 API で取るので、動的にしても負荷は小さい
- 内部 API の応答には、契約の `lastCollectedAt` に加えて `generatedAt`（応答を作った時刻）を入れた。画面がサーバーとの時計のずれを確かめられるようにするため

### E2E で分かったこと

- ヘッダーが 30 秒ごとに `/api/health` を取得し続けるので、Playwright の `networkidle` は待てない。TR-004（MBTA API を呼ばない）は、画面が表示されてから少し待ってリクエストを確かめる
- イメージのビルドでは `tests/` を含めないので、`tests/` を import する `playwright.config.ts` も `.dockerignore` に入れた
