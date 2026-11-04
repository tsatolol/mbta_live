---
description: "002 リアルタイム画面の実装タスク"
---

# タスク: リアルタイム画面（Live Dashboard）

**入力**: `/specs/002-live-dashboard/` の設計文書（spec.md、plan.md、research.md、contracts/live-api.md）と `.specify/memory/constitution.md`、`docs/architecture.md`、001 の DB スキーマ（`prisma/schema.prisma`）

**前提**: plan.md（必須）、spec.md（ユーザーストーリー）、contracts/live-api.md

**テスト**: spec.md のテスト要件（TR-001〜TR-004）に基づいてタスクを含める。内部 API は本物の PostgreSQL を使う結合テスト、計算する値は時計を固定した単体テスト、画面は Playwright の E2E。地図とグラフの見た目は画像で比べない。

**構成**: ユーザーストーリーごとに分ける。各ストーリーは、内部 API（テストを先に書く）→ 画面 → E2E の順に進める。

**001・004 との関係**: 読むテーブルはすべて 001 が作ったもの。新しいテーブルとマイグレーションは作らない。`/api/health` は 004 で作り済み。002 の完了後に 004 の T048（スモークテストに主要 API を足す）と T049（dev での E2E）を行う。

## 書式: `[ID] [P?] [Story] 説明`

- **[P]**: 並行して進められる（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: 対応するユーザーストーリー（US1〜US4）

---

## フェーズ 1: セットアップ（共通の土台）

**目的**: 画面の土台（Tailwind・shadcn/ui・TanStack Query・MapLibre）と E2E の実行環境

- [X] T001 依存を足す: `maplibre-gl`、`@tanstack/react-query`、Tailwind CSS（v4、`@tailwindcss/postcss`）、shadcn/ui の初期化（`components.json`、`src/components/ui/`、`src/lib/utils.ts`）。それぞれ 2 週間以上前に出た最新の安定版に固定する。`pnpm audit` が 0 件のままであることを確かめる: `package.json`、`pnpm-lock.yaml`、`postcss.config.mjs`、`src/app/globals.css`
- [X] T002 [P] Playwright を入れる: `@playwright/test`（開発環境にある Playwright 1.63 と同じバージョン）、`playwright.config.ts`（Chromium だけ、`webServer` で `pnpm build && pnpm start` を E2E 用の DB に向けて起動）、`pnpm test:e2e`。`pnpm test` には含めない: `package.json`、`playwright.config.ts`、`tests/e2e/`
- [X] T003 E2E 用のシードを書く: E2E 用の DB を作り直してマイグレーションを適用し、001 のフィクスチャ（平日 10:20 ET の記録）から静的データと現在値を入れる。フィクスチャの時刻（`updated_at`・予測時刻・`polled_at`・アラートの期間・`collector_runs`）を、テストの開始時刻に合わせてずらす（アプリの時計を偽装しない。方式を research.md に記録する）。特定の状態（更新の止まった車両、`Cancelled` の便、`SKIPPED` の便、収集が 3 分止まった状態、運行時間外）を作る関数も用意する: `tests/e2e/helpers/seed.ts`、`tests/e2e/global-setup.ts`

---

## フェーズ 2: 基盤（すべてのストーリーの前提）

**目的**: 共有の応答スキーマ、計算する値、共通のレイアウト（ヘッダー・フッター・環境バッジ）

**⚠️ 重要**: このフェーズが終わるまで、各ユーザーストーリーの画面は始められない

### 基盤のテスト

- [X] T004 [P] 計算する値の単体テスト（TR-002）: `isStale`（`now - updated_at >= 3 分`。境界の 2:59 / 3:00）、アラートの状態（`active_period` の区間に入っていれば `active`、すべて未来なら `upcoming`、それ以外は `past`。終わりのない区間、複数の区間）、あと何分か（切り捨て、0 分、過ぎた便）、stale バナーの判定（`lastCollectedAt` が null、3 分ちょうど）: `tests/unit/metrics/live.test.ts`
- [X] T005 [P] 路線形状のデコードの単体テスト: Google の encoded polyline を GeoJSON の座標（`[lon, lat]`）に変換する。既知の例と、フィクスチャの路線パターンの形状が対象地域（ボストン周辺）の範囲に入ること: `tests/unit/geo/polyline.test.ts`

### 基盤の実装

- [X] T006 [P] 計算する値を純粋関数で書く（T004 を通す）: `isStale`、`alertStatus`、`minutesUntil`、`isLiveDataStale`。現在時刻は引数で受け取る: `src/lib/metrics/live.ts`
- [X] T007 [P] encoded polyline のデコードを書く（T005 を通す。依存を足さずに書く）: `src/lib/geo/polyline.ts`
- [X] T008 共有の応答スキーマ（zod）を書く: 車両、予測（方向別）、アラート、路線（GeoJSON）、駅、稼働状況、エラー（`{ error: string }`）。すべての応答に `lastCollectedAt` を含める: `src/lib/api-schemas/{common,vehicles,predictions,alerts,routes,stops,status}.ts`
- [X] T009 Route Handler の共通部分を書く: クエリパラメータを zod で検証して不正なら 400、`lastCollectedAt` の取得（`collector_runs` の最後の成功）、`cache-control: no-store`、例外のログ（秘密の値を出さない）: `src/lib/api/handler.ts`、`src/lib/db/live.ts`
- [X] T010 共通のレイアウトを書く: TanStack Query の Provider、ナビゲーション（Map / Stations / Alerts / Status）、ヘッダー（最終更新時刻をボストン時間で表示。`/api/health` の `lastCollectedAt` を 30 秒ごとに取得）、`Live data is stale` のバナー（FR-006）、`APP_ENV` が `dev` のときの `DEV` バッジ（実行時の環境変数をサーバー側で読む。`NEXT_PUBLIC_*` を使わない）、フッターの出典表記（`Data provided by MBTA`、`© OpenFreeMap © OpenStreetMap contributors`。FR-008）: `src/app/layout.tsx`、`src/components/layout/{header,footer,providers}.tsx`

**チェックポイント**: 共通の土台ができた。ここから各ユーザーストーリーに入れる

---

## フェーズ 3: ユーザーストーリー 1 - 地図で全路線の列車の位置を見る（優先度: P1）🎯 MVP

**目標**: 地図に 8 路線の形状と車両（進行方向付き）が出て、15 秒ごとに更新される

**単独での確認方法**: E2E 用のシードで、地図に路線と車両が出て、路線フィルタ・ポップアップ・灰色の車両が動くことを確かめる

### ユーザーストーリー 1 のテスト

- [X] T011 [P] [US1] `GET /api/live/vehicles` の結合テスト（TR-001）: 全路線と `routes` での絞り込み、不正な `routes`（対象外の路線）で 400、`isStale` の計算、応答が共有のスキーマで解析できる: `tests/integration/api/live-vehicles.test.ts`
- [X] T012 [P] [US1] `GET /api/static/routes` の結合テスト: 8 路線が並び順で返り、路線色と、方向ごとの代表的な形状（canonical な路線パターン）が GeoJSON で入る: `tests/integration/api/static-routes.test.ts`

### ユーザーストーリー 1 の実装

- [X] T013 [US1] `GET /api/live/vehicles` を書く: `vehicles_current` に路線の色・行先（`direction_destinations`）・次の駅の名前（`stop_id` の親駅）を付けて返す。`stop_id` が null なら次の駅も null: `src/app/api/live/vehicles/route.ts`、`src/lib/db/live.ts`
- [X] T014 [US1] `GET /api/static/routes` を書く: `routes` と canonical な `route_patterns` の形状を GeoJSON にして返す。静的データなので長めにキャッシュしてよいかを決めて research.md に記録する: `src/app/api/static/routes/route.ts`、`src/lib/db/static-read.ts`
- [X] T015 [US1] 地図のコンポーネントを書く: MapLibre GL JS と OpenFreeMap の `positron`、路線形状を路線色の線で、車両を進行方向（`bearing`）に回転した矢印で描く。更新の止まった車両は灰色。車両のクリックで、路線・行先・次の駅・状態・何秒前の情報かのポップアップ。クライアント側だけで読み込む（`next/dynamic` の `ssr: false`）: `src/components/map/{live-map,vehicle-layer,route-layer}.tsx`
- [X] T016 [US1] 地図の画面を書く: 路線フィルタ（FR-002）、車両を 15 秒ごとに取得（TanStack Query の `refetchInterval`）、車両が 0 件のときは「運行時間外」と分かる表示: `src/app/page.tsx`
- [X] T017 [US1] 地図の E2E（TR-003、TR-004）: 路線と車両が出る、路線フィルタで絞り込める、車両のポップアップ、更新の止まった車両が灰色、運行時間外の表示、実行中にブラウザから `api-v3.mbta.com` へのリクエストがない。canvas の中身は画面の見た目で比べられないので、地図のソースとレイヤーの状態を確かめる方法（例: 地図のインスタンスから `queryRenderedFeatures` を読む）を検証して research.md に記録する: `tests/e2e/map.spec.ts`

**チェックポイント**: 地図の画面が単独で動く（MVP）

---

## フェーズ 4: ユーザーストーリー 2 - 駅を選んで次の列車を見る（優先度: P1）

**目標**: 駅を検索して、方向ごとに次の 3 本が「n min」でカウントダウンされる

**単独での確認方法**: E2E 用のシードで、駅の検索と到着表示、`Cancelled` の表示、アラートの表示を確かめる

### ユーザーストーリー 2 のテスト

- [X] T018 [P] [US2] `GET /api/static/stops` の結合テスト: 親駅の一覧（路線ごと）、`route` での絞り込み、不正な `route` で 400: `tests/integration/api/static-stops.test.ts`
- [X] T019 [P] [US2] `GET /api/live/predictions` の結合テスト（TR-001）: 親駅に属するホームの予測を方向別に、時刻の順で次の 3 本。`SKIPPED` と予定時刻が過ぎた便は除く。始発駅では `departure_time` を使う。運休（`CANCELLED`）の便は `cancelled` として返す。`stop` がない・不正で 400、存在しない駅で 404。その駅と路線に有効なアラートも返す: `tests/integration/api/live-predictions.test.ts`

### ユーザーストーリー 2 の実装

- [X] T020 [US2] `GET /api/static/stops` を書く: 路線パターンの `station_ids` から、路線ごとの親駅を並び順で返す: `src/app/api/static/stops/route.ts`、`src/lib/db/static-read.ts`
- [X] T021 [US2] `GET /api/live/predictions` を書く（T019 を通す）: 方向の名前と行先は路線の `direction_names` / `direction_destinations` から付ける（予測には便ごとの行先がないため。research.md に記録）: `src/app/api/live/predictions/route.ts`、`src/lib/db/live.ts`
- [X] T022 [US2] 駅の一覧の画面を書く: 駅名で検索、路線ごとにまとめて表示（FR-003）: `src/app/stations/page.tsx`
- [X] T023 [US2] 到着表示の画面を書く: 方向ごとに次の 3 本を「n min」で、30 秒ごとに取得し、毎秒カウントダウン（FR-004）。`Cancelled` の表示、有効なアラートの表示: `src/app/stations/[stopId]/page.tsx`、`src/components/arrivals/`
- [X] T024 [US2] 駅の E2E（TR-003）: 駅の検索、到着表示とカウントダウン（Playwright の時計を進める）、`Cancelled` の表示、`SKIPPED` の便が出ない、アラートの表示: `tests/e2e/stations.spec.ts`

**チェックポイント**: US1 と US2 が動く

---

## フェーズ 5: ユーザーストーリー 3 - 有効な運行アラートを一覧で見る（優先度: P2）

**目標**: 有効なアラートが路線別・重要度順に出て、予告と区別され、過去のアラートを検索できる

### ユーザーストーリー 3 のテスト

- [ ] T025 [P] [US3] `GET /api/live/alerts` の結合テスト（TR-001）: `status`（`active` / `upcoming` / `all`）の計算と絞り込み、`routes` での絞り込み、`from` / `to`（期間が重なるもの）、重要度の高い順、不正な値で 400: `tests/integration/api/live-alerts.test.ts`

### ユーザーストーリー 3 の実装

- [ ] T026 [US3] `GET /api/live/alerts` を書く: `alerts` と `alert_routes` を読み、状態は `alertStatus`（T006）で計算する。過去のアラート（フィードから消えたもの）も検索の対象にする: `src/app/api/live/alerts/route.ts`、`src/lib/db/live.ts`
- [ ] T027 [US3] アラートの画面を書く: 有効なアラートを路線ごとに重要度の高い順で、影響の種類（effect）のバッジ付きで表示。予告（`upcoming`）は別の区画に。過去のアラートの検索（期間・路線・種類）: `src/app/alerts/page.tsx`、`src/components/alerts/`
- [ ] T028 [US3] アラートの E2E（TR-003）: 有効なアラートの一覧、予告の区別、過去のアラートの検索: `tests/e2e/alerts.spec.ts`

**チェックポイント**: US1〜US3 が動く

---

## フェーズ 6: ユーザーストーリー 4 - データが新しいかどうかが分かる（優先度: P2）

**目標**: どの画面でも最終更新時刻と stale の警告が出て、稼働状況の画面で収集の結果が見られる

### ユーザーストーリー 4 のテスト

- [ ] T029 [P] [US4] `GET /api/status` の結合テスト: ジョブごとの直近の `collector_runs`（状態・件数・エラー）、レート制限の残量、テーブルごとの行数: `tests/integration/api/status.test.ts`

### ユーザーストーリー 4 の実装

- [ ] T030 [US4] `GET /api/status` を書く: テーブルの行数は、パーティションに分かれた大きなテーブルでも速く返せる方法（`pg_class.reltuples` の推定値など）にして、推定値であることを応答に含める: `src/app/api/status/route.ts`、`src/lib/db/status.ts`
- [ ] T031 [US4] 稼働状況の画面を書く（FR-007）: 直近の収集の結果、レート制限の残量、DB のデータ量: `src/app/status/page.tsx`
- [ ] T032 [US4] 共通部分と稼働状況の E2E（TR-003）: ヘッダーの最終更新時刻、収集が 3 分止まったときの stale バナー、`DEV` バッジ（`APP_ENV=dev` で起動）、フッターの出典表記、稼働状況の画面: `tests/e2e/layout.spec.ts`、`tests/e2e/status.spec.ts`

**チェックポイント**: すべてのユーザーストーリーが動く

---

## フェーズ 7: 仕上げと横断的な作業

**目的**: パイプラインへの組み込み、004 の残り、文書の反映、全体の確認

- [ ] T033 リリース用の CI で E2E を動かす: `pipeline.yml` の ci ジョブに、Playwright のブラウザの用意と `pnpm test:e2e`（Postgres のサービスコンテナに E2E 用の DB を作る）を足す。所要時間が延びすぎないか（SC-002 とは別に、CI 全体）を確かめる: `.github/workflows/pipeline.yml`
- [ ] T034 004 の T048 を行う: スモークテストに `/api/live/vehicles`・`/api/static/routes`・`/api/live/alerts` の確認を足す（共有のスキーマで解析できる）: `tests/smoke/smoke.test.ts`
- [ ] T035 004 の T049 を行う: dev の URL に対して、IAP を通して読み取りだけの短い E2E を cd-dev の最後に実行する: `tests/e2e/dev/`、`.github/workflows/pipeline.yml`
- [ ] T036 [P] 文書を更新する（flow-back）: `contracts/live-api.md` に実際の応答の形とパラメータ、`docs/architecture.md` に画面と内部 API の構成、`docs/development.md` に `pnpm test:e2e` と E2E 用の DB、CLAUDE.md のコマンド
- [ ] T037 確認: dev で各画面を開き、初回表示（SC-002。3 秒以内、コールドスタートを除く）と、地図に路線と車両が出ることを確かめる。結果を research.md に記録する
- [ ] T038 `/speckit-analyze` で 002 の文書とタスクの食い違いを点検し、見つかったものを反映する

---

## 依存関係と実行順

### フェーズの依存関係

- **セットアップ（フェーズ 1）**: 依存なし。T002 と T003 は T001 と並行できる
- **基盤（フェーズ 2）**: セットアップの完了が前提。T004〜T007 は並行できる。T008〜T010 は T006 の後
- **US1〜US4（フェーズ 3〜6）**: 基盤の完了が前提。ストーリー同士は独立しているが、`src/lib/db/live.ts` を共有するので、同じファイルを触るタスクは順に進める
- **仕上げ（フェーズ 7）**: US1〜US4 の完了が前提。T034〜T035 は prod へのデプロイと IAP が動いていることが前提（004 で確認済み）

### ユーザーストーリーの依存関係

- **US1（P1）**: 基盤だけが前提。最初に作る（MVP）
- **US2（P1）**: 基盤だけが前提。駅のページのアラート表示は US3 の API を使わず、予測の API が返す
- **US3（P2）**: 基盤だけが前提
- **US4（P2）**: 基盤だけが前提。ヘッダーと stale バナーは基盤（T010）で作るので、US4 は稼働状況の画面と E2E

### 同じファイルを触るタスク（並行しない）

- `src/lib/db/live.ts`: T009 → T013 → T021 → T026
- `src/lib/db/static-read.ts`: T014 → T020
- `.github/workflows/pipeline.yml`: T033 → T035

### 並行して進められるもの

- 基盤のテストと純粋関数（T004〜T007）
- 各ストーリーの API の結合テスト（T011、T012、T018、T019、T025、T029）

---

## 実装の進め方

### MVP（ユーザーストーリー 1 のみ）

1. セットアップと基盤（フェーズ 1〜2）
2. US1（地図）→ dev にデプロイして地図が見られることを確かめる
3. 以降のストーリーを順に足す。各ストーリーの完了ごとに PR を作り、dev で確かめてから prod に出す

### `/speckit-implement` の範囲の区切り方

コンテキストがあふれないよう、1 回の実行はフェーズ単位にする（フェーズ 1〜2、フェーズ 3、フェーズ 4、…）。

---

## 注意

- [P] は別のファイルで、未完了のタスクに依存しないもの
- [Story] はユーザーストーリーとの対応を示す
- ブラウザから MBTA API を呼ばない。内部 API は DB だけを読む（憲章の原則 I・II）
- 外部入力（クエリパラメータ）は zod で検証する。`any` を使わない
- 時刻は API では UTC、画面でボストン時間に変換する。運行日の計算は `src/lib/time.ts` だけ
- 「検証して research.md に記録する」と書いたタスクは、実装時に試した結果（採った方式と、採らなかった方式とその理由）を research.md に残す（flow-back）
