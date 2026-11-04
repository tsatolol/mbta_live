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

## フェーズ 3（US1 地図）の実装で決めたこと（2026-11-04）

### 内部 API の作り方

- Route Handler の中身は、DB と時計を引数で受け取る関数にして `src/lib/api/` に置き（`getVehicles({ db, clock })` など）、`src/app/api/**/route.ts` からは本番の DB と時計を渡して呼ぶだけにした。Next.js の route ファイルは HTTP メソッド以外を export できないので、結合テストはこの関数を直接呼ぶ
- 結合テストのデータは、E2E と同じく、フィクスチャを本番と同じ collector の処理で取り込む（`tests/helpers/live-seed.ts`）
- `GET /api/static/routes` もキャッシュせず（`no-store`）、画面側で 1 時間は取り直さない（TanStack Query の `staleTime`）。IAP の背後なので共有のキャッシュは効かず、応答も小さいため

### 路線形状

- 路線・方向ごとの canonical な路線パターンの形状を描く。フィクスチャでは canonical は typicality 1 と一致し、各方向 1 つ（Red だけは分岐で Ashmont と Braintree の 2 つ）

### MapLibre の Web Worker（Next.js でまとめたときの問題）

- MapLibre GL JS 6 は、自分のファイルの場所（`import.meta.url`）の隣の `maplibre-gl-worker.mjs` を Worker として読む。Next.js（Turbopack）でまとめるとファイルの場所が変わり、「Worker failed to load」で地図のソースが読み込まれなかった（E2E で `idle` が来ずに気づいた）
- **対応**: ビルドの前に `scripts/copy-maplibre-worker.mjs` で Worker を `public/vendor/` にコピーし（`pnpm build` / `pnpm dev` が実行する。git には入れない）、地図のコンポーネントで `setWorkerUrl()` にその URL を渡す。イメージには `public/` も入れる（Dockerfile）

### 地図の E2E

- 地図のタイル（OpenFreeMap）は E2E では外部から取らず、空のスタイルを返す（`tests/e2e/helpers/map.ts`）。地図の中身の確認にタイルは要らず、外部のサーバーの状態に左右されない。タイルの読み込みは dev での E2E（004 T049）で確かめる
- 地図の中身は canvas の見た目ではなく、地図のインスタンス（`window.__mbtaMap`）のソースのデータ（`getSource(...).serialize()`）とレイヤーのフィルタ（`getFilter()`）で確かめる。ポップアップは、車両の位置を画面の座標に変換（`map.project()`）してクリックして確かめる
- ヘッドレスの Chromium（Playwright 1.63）でも WebGL で描画でき、クリックで車両を選べた（特別な起動オプションは要らなかった）

## フェーズ 4（US2 駅と到着表示）の実装で決めたこと（2026-11-04）

### 駅の一覧（`GET /api/static/stops`）

- 路線ごとの駅の並びは、方向 0 の canonical な路線パターンの `station_ids` をつないで作る。分岐のある路線（Red）は、最初のパターンの駅のあとに、ほかのパターンにだけある駅を続ける（Alewife → … → JFK/UMass → Ashmont 支線 → Braintree 支線、22 駅）
- 複数の路線が通る駅（Park Street など）は、それぞれの路線に出す。検索は駅名の部分一致（大文字・小文字を区別しない）を画面側で行う（全 8 路線で 150 駅程度なので、一度に取得する）

### 到着表示（`GET /api/live/predictions`）

- **方向の一覧**: 典型的な路線パターン（canonical か typicality 1）のうち、その駅を通り、かつその駅が終点でないものの路線と方向を出す。終点では、その方向の「次の列車」は来ないため（Alewife は Red の方向 0 だけ）。予測がなければ空の一覧（No upcoming trains）を出す
- **方向の名前と行先**: 予測には便ごとの行先がないので、路線の `direction_names` / `direction_destinations` から付ける（Red の方向 0 は「Ashmont/Braintree」）
- **時刻**: `arrival_time`、なければ（始発駅）`departure_time` を使い、`timeKind` で区別する（画面は Arrives / Departs）。時刻が今以前の便は除く
- **運休の便**: MBTA は `CANCELLED` の便の到着・出発時刻をふつう `null` で返す（001 contracts/mbta-api.md）。時刻のない便は並べる場所がないので除き、時刻のある運休の便だけを `cancelled: true` で返す。時刻表（schedules）は収集していないため、時刻のない運休の便を元の時刻に置くことはしない。E2E のシードは、時刻のある便を `CANCELLED` にして表示を確かめる
- **アラート**: alert_routes で駅の路線に関係する、今のフィードにある（`in_feed`）アラートのうち、状態が `active` で、`informed_entity` のどれかが「駅の路線（路線の指定がなければどれでも）」かつ「駅かそのホームを指す、または駅を指定しない（路線全体）」もの。フィクスチャのアラートはほとんどが駅を指定していて（Jackson Square の STATION_ISSUE など）、路線で絞るだけだと、ほかの駅のアラートまで出てしまうため
- 判定は純粋関数（`src/lib/metrics/arrival-board.ts`）にして単体テストする。001 の到着の検出（`arrivals.ts`）とは別のファイルにした

### 到着表示の画面

- 「n min」は切り捨てで、1 分未満は「< 1 min」。毎秒進むことが見えるように、隣に m:ss の残り時間も出す。取得のあとに時刻が過ぎた便は、次の取得（30 秒ごと）を待たずに画面から消す
- 存在しない駅（404）は取り直さず、Station not found と出す
- カウントダウンの E2E は Playwright の時計（`page.clock`）を止めて進める。シードの時刻は実際の今に合わせてあるので、時計は今の時刻のまま入れる

## フェーズ 5（US3 アラート）の実装で決めたこと（2026-11-04）

### 過去のアラートの扱い

- MBTA は解消したアラートをフィードから消す。終わりのない区間（`end` が null）のまま消えることが多いので、`active_period` だけで状態を計算すると、消えたアラートが `active` のままになる。**フィードから消えたアラート（`in_feed = false`）は `past` とし、区間は最後に見た時刻（`last_seen_at`）で終わらせる**（`src/lib/metrics/alerts.ts` の `effectivePeriods`）。応答の `activePeriod` もこの区間にする
- 収集は prod で 1 分間隔なので、実際に解消した時刻との差は 1 分程度

### `GET /api/live/alerts` のパラメータ

- `from` / `to` は運行日（`YYYY-MM-DD`、ET 03:00 区切り。`src/lib/time.ts`）。その期間と、実際に有効だった区間が重なるものを返す。区間の終わりは含まない
- 検索で「種類」を絞れるように、契約に `effects`（カンマ区切り）を足した
- 期間での絞り込みは、DB から路線・種類・`in_feed` で絞った行を読んでから純粋関数で行う。アラートは 1 日に数件〜数十件しか増えないので、全件を読んでも小さい。返すのは重要度の高い順に最大 200 件（`truncated` で切り詰めたかを示す）

### アラートの画面

- 「路線ごと」は、関係する路線の組み合わせごとにまとめる。Green の 4 支線にまたがるアラートを支線ごとに 4 回出さないため。まとまりは最初の路線の並び順
- 有効なアラートと予告を別の区画に出し、1 分ごとに取り直す。過去のアラートの検索は送信したときだけ取得する。期間の既定は直近 7 日
- 検索で選べる種類は、地下鉄でよく使われる effect の一覧を画面に持つ（`SEARCHABLE_EFFECTS`）。一覧にない effect も API では検索できる
- E2E のシードで、フィードから消えた過去のアラート（3 日前の Red の遅延）を 1 件作る
