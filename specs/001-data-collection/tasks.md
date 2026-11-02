---
description: "001 データ収集の実装タスク"
---

# タスク: データ収集（Data Collection）

**入力**: `/specs/001-data-collection/` の設計文書（spec.md、plan.md、data-model.md、contracts/mbta-api.md、research.md、quickstart.md）と `.specify/memory/constitution.md`

**前提**: plan.md（必須）、spec.md（ユーザーストーリー）、data-model.md、contracts/

**テスト**: spec.md のテスト要件（TR-001〜TR-008）に基づいてテストのタスクを含める。各ストーリーでは、テストを先に書いて失敗することを確かめてから実装する。テストでは実 API を呼ばず、DB を使うテストは本物の PostgreSQL 16 で行い、現在時刻は固定する（憲章の原則 IV）。

**構成**: ユーザーストーリーごとに分け、それぞれ単独で実装・確認できるようにする。

## 書式: `[ID] [P?] [Story] 説明`

- **[P]**: 並行して進められる（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: 対応するユーザーストーリー（US1〜US5）
- パスは [docs/architecture.md](../../docs/architecture.md) のリポジトリ構成に従う（Next.js 一体型の単一プロジェクト）

---

## フェーズ 1: セットアップ（共通の土台）

**目的**: プロジェクトの初期化と基本構成

- [X] T001 Next.js（App Router、TypeScript `strict`、`output: "standalone"`）のプロジェクトを pnpm と Node.js 24.x で作る: `package.json`、`tsconfig.json`、`next.config.ts`、`src/app/layout.tsx`、`src/app/page.tsx`（仮の 1 ページだけ）
- [X] T002 [P] ESLint と Prettier を設定し、`pnpm lint` と `pnpm typecheck`（`tsc --noEmit`）のスクリプトを追加する: `eslint.config.mjs`、`.prettierrc`、`package.json`
- [X] T003 [P] Vitest を unit / integration / replay の 3 つのプロジェクトに分けて設定し、`pnpm test`（3 つすべて）、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:replay` を追加する: `vitest.config.ts`、`package.json`
- [X] T004 [P] ローカル用 PostgreSQL 16 の `docker-compose.yml` を作る（サービス名 `db`、開発用 DB `mbta_live` とテスト用 DB `mbta_live_test` を作成する初期化 SQL を含む）: `docker-compose.yml`、`docker/postgres/init.sql`
- [X] T005 [P] `.gitignore`（`src/generated/`、`.env.local`、`node_modules/` など）と `.env.example`（docs/development.md の環境変数の表をすべて含める）を作る
- [X] T006 依存関係を追加する: `prisma`、`@prisma/client`、`@prisma/adapter-pg`、`pg`、`zod`、`date-fns`、`@date-fns/tz`、`server-only`、`tsx`、`fast-check`。スクリプト `postinstall`（`prisma generate`）、`db:migrate`（`prisma migrate deploy`）、`db:migrate:dev`、`db:generate`、`job:collect`、`job:sync-static`、`job:aggregate` を `package.json` に追加する
- [X] T007 [P] 実 API からフィクスチャを記録するスクリプトを作る（`pnpm fixtures:record`）。`/vehicles`・`/predictions`・`/alerts`・`/routes`・`/stops` ①②・`/route_patterns` を contracts/mbta-api.md のパラメータで 1 回ずつ取得し、`tests/fixtures/mbta/<endpoint>-<YYYYMMDD-HHmm>.json` に保存する。リクエストの間隔を空け、合計 7 リクエスト以内にする: `scripts/record-fixtures.ts`
- [X] T008 T007 のスクリプトで、平日の運行時間中のフィクスチャを記録してコミットする（2026-11-01 の日曜早朝に記録した初期フィクスチャが `tests/fixtures/mbta/` にある。内容は同じディレクトリの README.md）。特殊ケース用のフィクスチャ（運行時間外の空の応答、`stop` が `null` の車両、`updated_at` が 30 分前の車両、`UPCOMING` のアラート、`CANCELLED` / `SKIPPED` / 始発駅の予測、`Shuttle-*` の路線パターン、スキーマに合わない行）は、記録した応答から行を抜き出して `tests/fixtures/mbta/cases/` に作る

---

## フェーズ 2: 基盤（すべてのストーリーの前提）

**目的**: どのユーザーストーリーにも必要な基盤

**⚠️ 重要**: このフェーズが終わるまで、ユーザーストーリーの作業は始められない

### 基盤のテスト

- [X] T009 [P] 運行日と時刻のテストを書く（TR-004）: 深夜 0〜3 時（ET）は前日の運行日、夏時間の開始日（2027-03-14）と終了日（2026-11-01）の運行日の境界と長さ（23 / 25 時間）、`-04:00` / `-05:00` のオフセット付き文字列のパース: `tests/unit/time.test.ts`
- [X] T010 [P] MBTA クライアントのテストを書く（TR-008 の一部）: `MBTA_API_KEY` があれば `x-api-key` ヘッダーを送り、なければ送らない、レート制限ヘッダー（`x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset`）を読む、429 で `RateLimitedError` を投げてリトライしない、リクエスト数を数える、`MBTA_FIXTURE_MODE=1` でフィクスチャを返す。`fetch` は引数で差し替える: `tests/unit/mbta/client.test.ts`
- [X] T011 [P] JSON:API の解析のテストを書く: スキーマに合わない行はスキップされ、件数が返る（ジョブは失敗しない）: `tests/unit/mbta/jsonapi.test.ts`

### 基盤の実装

- [X] T012 [P] 運行日と時刻の関数を実装する: `serviceDateOf(instant)`（`America/New_York` の時刻から 3 時間引いた日付）、`serviceDayRange(serviceDate)`（その運行日の開始と終了の UTC 時刻。ET の 03:00 区切り）、`parseMbtaDateTime(string)`（オフセット付き）、表示用の ET 変換: `src/lib/time.ts`
- [X] T013 [P] 時計を実装する: `Clock` インターフェース、`systemClock`、テスト用の `fixedClock(instant)`: `src/lib/clock.ts`
- [X] T014 [P] 定数を定義する: 対象 8 路線の ID（`Red`, `Mattapan`, `Orange`, `Blue`, `Green-B`, `Green-C`, `Green-D`, `Green-E`）、route_type（`0`, `1`）: `src/lib/mbta/constants.ts`。リード時間のバケット `[1, 3, 5, 10, 15]` 分、更新の止まった車両とみなす秒数 `180`: `src/lib/metrics/constants.ts`
- [X] T015 MBTA API クライアントを実装する（T010 を通す）: Base URL は `MBTA_API_BASE_URL`（既定値 `https://api-v3.mbta.com`）、`MBTA_API_KEY` は任意、`fields[...]` と `filter[...]` の組み立て、レート制限ヘッダーの読み取り、429 で `RateLimitedError`、リクエスト数のカウンタ、フィクスチャモード。`import "server-only"` を付ける: `src/lib/mbta/client.ts`
- [X] T016 JSON:API の共通の zod スキーマと、行ごとに `safeParse` して `{ rows, rejected }` を返す関数を実装する（T011 を通す）: `src/lib/mbta/jsonapi.ts`
- [X] T017 [P] 構造化ログ（JSON を標準出力へ。件数、解析に失敗した行数、未解決の駅 ID の数を出す。004 のログベースの指標で使う）: `src/lib/log.ts`
- [X] T018 Prisma の設定と DB クライアントを作る: `prisma.config.ts`、`prisma/schema.prisma` の datasource と generator（出力先 `src/generated/prisma`）、`src/lib/db/client.ts`（`@prisma/adapter-pg` + `pg`。`DATABASE_URL` があればそれを、なければ Unix ソケット `/cloudsql/<INSTANCE_CONNECTION_NAME>` と `DB_NAME` / `DB_USER` / `DB_PASSWORD` を使う。`import "server-only"`）
- [X] T019 data-model.md の 001 のテーブルをすべて `prisma/schema.prisma` にモデルとして書く: `routes`, `stops`, `route_patterns`, `vehicles_current`, `predictions_current`, `alerts`, `alert_routes`, `vehicle_positions`, `prediction_samples`, `arrival_events`, `collector_runs`, `unknown_stop_ids`。モデル名は PascalCase、フィールド名は camelCase で `@@map` / `@map` により snake_case に対応づけ、時刻の列には `@db.Timestamptz` を付ける。主キーは data-model.md のとおり（`vehicle_positions` は (`vehicle_id`, `updated_at`)、`prediction_samples` は (`service_date`, `trip_id`, `stop_id`, `lead_bucket_min`)、`arrival_events` は (`service_date`, `trip_id`, `stop_id`)）
- [X] T020 初期マイグレーションを `prisma migrate dev --create-only` で作り、SQL を手で書き換える: スキーマ `partitions` を作成し、`vehicle_positions` を `PARTITION BY RANGE (updated_at)`、`prediction_samples` と `arrival_events` を `PARTITION BY RANGE (service_date)` にする: `prisma/migrations/<timestamp>_init/migration.sql`
- [X] T021 パーティションの作成関数を実装する: `ensurePartitions(serviceDates)` が 3 つの履歴テーブルについて、運行日ごとの子テーブルを `partitions` スキーマに `CREATE TABLE IF NOT EXISTS ... PARTITION OF` で作る。`vehicle_positions` の範囲は `serviceDayRange()` の UTC 時刻、他の 2 つは `service_date` の 1 日: `src/lib/db/partitions.ts`
- [X] T022 テスト用 DB の補助関数を作る: テスト用 DB にマイグレーションを適用し、テストごとにテーブルを空にし、フィクスチャから静的データ（路線・駅・路線パターン）を投入する: `tests/helpers/db.ts`、`tests/helpers/seed.ts`
- [X] T023 Prisma の drift の検証テストを書いて実行する（research.md の未解決事項）: テスト用 DB に子テーブルを作った後、`prisma migrate diff`（DB とスキーマの比較、`--exit-code`）で差分が出ないことを確かめる。差分が出たら方式を見直し、data-model.md と research.md と CLAUDE.md の未決事項を更新する: `tests/integration/prisma-drift.test.ts`
- [X] T024 ジョブの共通部分を実装する: `runJob(name, fn)` が `collector_runs` に開始・終了時刻、成否（`success` / `failed` / `skipped`）、件数、レート制限の残量、エラーを記録して終了コードを決める。`withAdvisoryLock(key, fn)` は `pg_try_advisory_lock` が取れなければ `skipped` ですぐ終わる: `src/jobs/runner.ts`

**チェックポイント**: 基盤が完成。ここからユーザーストーリーに入れる

---

## フェーズ 3: ユーザーストーリー 1 - 最新の運行状況が常に DB にある（優先度: P1）🎯 MVP

**目標**: collector を 1 回実行すると、対象 8 路線の車両・予測・アラートの現在値と車両位置の履歴が DB に入り、実行結果が記録される

**単独での確認方法**: フィクスチャで collector を 1 回実行し、現在値テーブルに行が入ること、`collector_runs` に成功が記録されることを確かめる

### ユーザーストーリー 1 のテスト

- [X] T025 [P] [US1] 車両・予測・アラートの応答の解析テストを書く（TR-001 の一部）: 通常のフィクスチャと `tests/fixtures/mbta/cases/` の特殊ケース（運行時間外の空の応答、`stop` が `null` の車両、`updated_at` が 30 分前の車両、`UPCOMING` のアラート、`CANCELLED`（到着・出発時刻がどちらも `null`）/ `SKIPPED` / 始発駅（`arrival_time` が `null`）の予測、スキーマに合わない行）: `tests/unit/mbta/realtime.test.ts`
- [X] T026 [P] [US1] collector の結合テストを書く（TR-006、TR-008）: 現在値テーブルが入れ替わる、運行時間外の応答で現在値が空になり成功として記録される、1 回のリクエスト数が 3、429 で失敗として記録されリトライせず現在値が前の状態のまま、書き込みの途中で失敗すると前の状態が残る（トランザクション）、2 つの collector を同時に動かすと後の方が `skipped` ですぐ終わる: `tests/integration/collect.test.ts`

### ユーザーストーリー 1 の実装

- [X] T027 [P] [US1] 車両の zod スキーマとドメイン型への変換を実装する（`bearing`, `current_status`, `current_stop_sequence`, `direction_id`, `label`, `latitude`, `longitude`, `revenue`, `speed`, `carriages`, `updated_at`、リレーション `route` / `stop`（`null` 可）/ `trip`）: `src/lib/mbta/schemas/vehicle.ts`
- [X] T028 [P] [US1] 予測の zod スキーマと変換を実装する（`arrival_time` / `departure_time` は `null` 可、`schedule_relationship` は `null` 可の文字列、`update_type`、`uncertainty_sec` = `arrival_uncertainty ?? departure_uncertainty`、リレーション `route` / `stop` / `trip` / `vehicle`（`null` 可））: `src/lib/mbta/schemas/prediction.ts`
- [X] T029 [P] [US1] アラートの zod スキーマと変換を実装する（`effect` / `cause` / `lifecycle` は列挙型にせず文字列、`severity` は整数、`active_period` の `end` は `null` 可、`informed_entity`、`short_header`, `service_effect`, `timeframe`）: `src/lib/mbta/schemas/alert.ts`
- [X] T030 [US1] 3 つのエンドポイントを取得する関数を実装する（`filter[route]` に対象 8 路線、`fields[...]` で必要な属性だけ）: `src/lib/mbta/realtime.ts`
- [X] T031 [US1] 現在値の入れ替えを実装する: `$transaction` の中で `vehicles_current` と `predictions_current` を `deleteMany` → `createMany`: `src/lib/db/current.ts`
- [X] T032 [US1] アラートの保存を実装する: 1 本の `$executeRaw`（`INSERT ... ON CONFLICT (id) DO UPDATE`）で upsert し、`first_seen_at` は初回の値を保ち、`last_seen_at` を更新し、`in_feed = true` にする。今回のフィードにないアラートは `in_feed = false` にする。`alert_routes` は `informed_entity` の `route` のうち対象 8 路線のものから作り直す: `src/lib/db/alerts.ts`
- [X] T033 [US1] 車両位置の履歴の保存を実装する: `vehicle_positions` に `createMany({ skipDuplicates: true })`（`updated_at` が前回と同じ車両は主キーの重複で入らない）: `src/lib/db/history.ts`
- [X] T034 [US1] collector のジョブを実装する: `withAdvisoryLock` → `ensurePartitions`（今日と明日の運行日）→ 3 つのエンドポイントを取得 → 解析 → 1 つのトランザクションで現在値・アラート・車両位置を書き込む → `runJob` で件数・解析に失敗した行数・レート制限の残量を記録する。現在時刻は `Clock` から取る: `src/jobs/collect.ts`

**チェックポイント**: US1 が単独で動く（T025、T026 が通る）

---

## フェーズ 4: ユーザーストーリー 2 - 実際の到着時刻が記録される（優先度: P1）

**目標**: collector の各回で、前回との差から各便の各親駅への到着を推定し、`arrival_events` に推定方法とともに記録する

**単独での確認方法**: 2 回分の車両・予測のフィクスチャを順に入力し、期待どおりの到着イベントが作られることを確かめる

### ユーザーストーリー 2 のテスト

- [X] T035 [P] [US2] 到着検出の単体テストを、入力と期待値の表で書く（TR-002）: `STOPPED_AT` で `source = stopped_at`（`arrived_at = updated_at`）、複数駅を進んだときに前回の予測で `predicted_last`、予測もないときに `interpolated`、`updated_at` が 180 秒以上前の車両と `revenue != REVENUE` の車両は対象外、`stop` が `null` の車両、ホーム（`Alewife-01` などの番線を含む）から親駅への変換、同じ便・親駅を 2 回検出しても 1 件: `tests/unit/metrics/arrivals.test.ts`
- [X] T036 [P] [US2] 「便と親駅の組で到着は 1 件」「同じ便の到着時刻は停車順に単調に増える」をプロパティベーステスト（fast-check）で確かめる（TR-002）: `tests/unit/metrics/arrivals.property.test.ts`
- [X] T037 [P] [US2] collector の結合テストを書く: 2 回分のフィクスチャを順に流すと、期待どおりの `arrival_events` が入る: `tests/integration/collect-arrivals.test.ts`

### ユーザーストーリー 2 の実装

- [X] T038 [P] [US2] 駅の索引を読み込む関数を実装する: ホーム → 親駅の対応、路線パターンごとの停車順（`platform_stop_ids`）: `src/lib/db/stop-index.ts`
- [X] T039 [US2] 到着検出の純粋関数を実装する（T035、T036 を通す）: 入力は前回の車両と予測、今回の車両、駅の索引、時計。進んだ区間の駅は前回の予測（その便の `stop_sequence` → 駅）から、なければ路線パターンの停車順から求める。出力は `arrival_events` の行（`service_date` は `arrived_at` の運行日、`precision_sec` 付き）: `src/lib/metrics/arrivals.ts`
- [X] T040 [US2] collector に組み込む: 現在値を入れ替える前に前回の `vehicles_current` と `predictions_current` を読み、到着イベントを `createMany({ skipDuplicates: true })` で書き込む（同じトランザクション内）: `src/jobs/collect.ts`

**チェックポイント**: US1 と US2 が動く

---

## フェーズ 5: ユーザーストーリー 3 - 予測の記録が分析できる量に抑えられている（優先度: P2）

**目標**: 予測を、リード時間のバケットごとに便・親駅あたり 1 件だけ `prediction_samples` に保存する

**単独での確認方法**: 同じ便・駅の予測を到着の 16 分前から 0 分前まで 1 分ごとに入力し、バケットごとに 1 件だけ残ることを確かめる

### ユーザーストーリー 3 のテスト

- [X] T041 [P] [US3] サンプリングの単体テストを書く（TR-003）: 16 分前から 0 分前まで 1 分ごとの予測で、バケット `[1, 3, 5, 10, 15]` ごとに最初の 1 件だけになる、リード時間が 15 分を超える予測と 0 以下の予測は対象外、`CANCELLED` / `SKIPPED` / `arrival_time` が `null` の予測は保存しない: `tests/unit/metrics/sampling.test.ts`
- [X] T042 [P] [US3] collector の結合テストを書く: 連続した複数回の実行で、`prediction_samples` の行がバケットごとに 1 件のまま増えない: `tests/integration/collect-samples.test.ts`

### ユーザーストーリー 3 の実装

- [X] T043 [US3] サンプリングの純粋関数を実装する（T041 を通す）: `lead = predicted_arrival - observed_at` に対して `lead` 以上で最小のバケットを返す関数と、予測から `prediction_samples` の行（`stop_id` は親駅、`service_date` は予測到着時刻の運行日、`update_type`、`uncertainty_sec`）を作る関数: `src/lib/metrics/sampling.ts`
- [X] T044 [US3] collector に組み込む: `prediction_samples` に `createMany({ skipDuplicates: true })` で書き込む（同じトランザクション内）: `src/jobs/collect.ts`

**チェックポイント**: US1〜US3 が動く

---

## フェーズ 6: ユーザーストーリー 4 - 駅と路線の情報が毎日更新される（優先度: P2）

**目標**: sync-static のジョブで、路線・駅・路線パターンを毎日 upsert し、collector が見つけた未知の駅 ID を解決する

**単独での確認方法**: フィクスチャで sync-static を実行し、8 路線、親駅 125 件、ホーム（終点駅の番線 12 件を含む）、対象 8 路線の路線パターン（通常運行は 18 件）が保存されることを確かめる

### ユーザーストーリー 4 のテスト

- [X] T045 [P] [US4] 静的データの解析テストを書く（TR-001 の一部）: `/routes` が 8 路線、`/stops` ① がホーム 265 件と親駅 125 件、② の `child_stops` を `location_type = 0` かつ `vehicle_type` が 0 / 1 で絞ると 12 件（`Alewife-01/02`, `Braintree-01/02`, `Forest Hills-01/02`, `Oak Grove-01/02`, `Union Square-01/02`, `Government Center-Brattle`, `71199`）が加わる、`/route_patterns` から `Shuttle-*` が除かれる: `tests/unit/mbta/static.test.ts`
- [X] T046 [P] [US4] sync-static の結合テストを書く: 件数どおりに保存される、2 回実行しても件数が変わらない、`unknown_stop_ids` の未解決の ID が ③ で取得されて `resolved_at` が入る: `tests/integration/sync-static.test.ts`

### ユーザーストーリー 4 の実装

- [X] T047 [P] [US4] 路線・駅・路線パターンの zod スキーマと変換を実装する（路線パターンの `station_ids` はホームから親駅に変換して作る）: `src/lib/mbta/schemas/route.ts`、`src/lib/mbta/schemas/stop.ts`、`src/lib/mbta/schemas/route-pattern.ts`
- [X] T048 [US4] 静的データの取得を実装する: `/routes`、`/stops` ①②、`/route_patterns`、未解決の駅 ID があれば `/stops` ③（`filter[id]=`）: `src/lib/mbta/static.ts`
- [X] T049 [US4] 静的データの upsert を実装する（`$executeRaw` でテーブルごとに 1 本の SQL）: `src/lib/db/static.ts`
- [X] T050 [US4] sync-static のジョブを実装する: `withAdvisoryLock` → 取得 → upsert → 解決した `unknown_stop_ids` に `resolved_at` を入れる → `runJob` で記録（`job = sync-static`）: `src/jobs/sync-static.ts`
- [X] T051 [US4] collector で未知の駅 ID を記録する: 車両・予測の `stop` が `stops` にない場合、ログに出して `unknown_stop_ids` に `ON CONFLICT DO NOTHING` で入れる: `src/jobs/collect.ts`

**チェックポイント**: US1〜US4 が動く

---

## フェーズ 7: ユーザーストーリー 5 - 古い生データは自動で消え、集計前のデータは消えない（優先度: P3）

**目標**: 保持期間（`RAW_RETENTION_DAYS`。prod 28 / dev 3）を過ぎ、集計が済んだ運行日のパーティションだけを削除する

**単独での確認方法**: 複数の運行日のパーティションと `aggregate_runs` の状態を用意し、削除されるもの・残るものを確かめる

### ユーザーストーリー 5 のテスト

- [X] T052 [P] [US5] 保持期間の結合テストを書く（TR-007）: 今日から 3 日先までのパーティションが作られる、保持期間を過ぎて `aggregate_runs.status = success` の運行日のパーティションは削除される、保持期間を過ぎても集計が済んでいない運行日は残る、保持期間内のものは残る: `tests/integration/retention.test.ts`

### ユーザーストーリー 5 の実装

- [X] T053 [US5] `aggregate_runs` テーブル（`service_date` PK, `status`, `finished_at`, `definition_version`。定義は `specs/003-analytics/data-model.md`）を `prisma/schema.prisma` に追加し、マイグレーションを作る（保持期間の判定に必要なため 001 で先に作る）
- [X] T054 [US5] 期限切れのパーティションの削除を実装する: `dropExpiredPartitions(now, retentionDays)` が、保持期間を過ぎ、`aggregate_runs.status = success` の運行日の子テーブルだけを `DROP TABLE` する: `src/lib/db/partitions.ts`
- [X] T055 [US5] aggregate ジョブの土台を作り、今はパーティションの管理だけを行う: `ensurePartitions`（今日から 3 日先まで）→ `dropExpiredPartitions` → `runJob` で記録（`job = aggregate`）。集計は 003 で追加する: `src/jobs/aggregate.ts`

**チェックポイント**: すべてのユーザーストーリーが単独で動く

---

## フェーズ 8: 仕上げと横断的な作業

**目的**: 複数のストーリーにまたがる確認と文書の反映

- [X] T056 [P] 連続ポーリングを記録するスクリプトを作る（`pnpm fixtures:record-sequence --count 30`）: 60 秒ごとに `/vehicles`・`/predictions`・`/alerts` を取得し（3 req/分）、`tests/fixtures/mbta/sequences/<YYYYMMDD-HHmm>/<NNN>-<endpoint>.json.gz`（容量を抑えるため gzip）と `index.json`（各回の記録時刻）に保存する: `scripts/record-sequence.ts`（フェーズ 4 の T037 のために先に作った。4 回分の記録 `sequences/20261102-1228/` を T037 で使っている）
- [ ] T057 平日に連続ポーリングを 2 本記録してコミットする: 運行開始の時間帯（05:00 ET ごろから 30 回以上）と日中（30 回以上）。日中の記録から `/predictions` の件数とサイズを測り、`contracts/mbta-api.md` と CLAUDE.md の未決事項を更新する（flow-back）
- [ ] T058 再生テストを書く（TR-005）: T057 の記録を時計を固定して collector に順に流し、`arrival_events`・`prediction_samples`・`vehicle_positions` の最終状態を期待値と比べる。期待値は件数と、目で確かめた代表的な便の到着時刻に絞る。同じ回を 2 回流しても行が増えないことも確かめる: `tests/replay/collector-replay.test.ts`
- [ ] T059 [P] 性能を確かめる（SC-004）: 日中のピークの記録で collector 1 回が 50 秒を大きく下回ることを、結合テストで所要時間を測って確かめる: `tests/integration/collect-performance.test.ts`
- [ ] T060 [P] データ量を確かめる（SC-005）: T057 の記録から 1 回あたりの行数を求め、data-model.md の「データ量の目安」を実測値で更新する（flow-back）
- [ ] T061 quickstart.md の手順を最初から実行し、書かれている結果になることを確かめる。コマンドが変わっていれば docs/development.md も更新する
- [ ] T062 `/speckit-analyze` で 001 の文書とタスクの食い違いを点検し、見つかったものを反映する

---

## 依存関係と実行順

### フェーズの依存関係

- **セットアップ（フェーズ 1）**: 依存なし。すぐ始められる
- **基盤（フェーズ 2）**: セットアップの完了が前提。すべてのユーザーストーリーをブロックする
- **ユーザーストーリー（フェーズ 3〜7）**: 基盤の完了が前提
- **仕上げ（フェーズ 8）**: US1〜US4 の完了が前提（T058 は US1〜US3 が必要）

### ユーザーストーリーの依存関係

- **US1（P1）**: 基盤の完了後に始められる。他のストーリーに依存しない
- **US2（P1）**: 到着検出の純粋関数（T035、T036、T039）は基盤の完了後すぐ始められる。collector への組み込み（T040）は US1 の `src/jobs/collect.ts` が必要。ホーム → 親駅の対応には `stops` のデータが要るが、テストでは `tests/helpers/seed.ts` でフィクスチャから投入するので US4 を待たなくてよい
- **US3（P2）**: 純粋関数（T041、T043）はすぐ始められる。組み込み（T044）は US1 が必要。親駅への変換は US2 と同じく seed で代用できる
- **US4（P2）**: sync-static（T045〜T050）は US1 に依存しない。T051 は US1 の `src/jobs/collect.ts` が必要
- **US5（P3）**: T021（基盤）の `ensurePartitions` が必要。他のストーリーには依存しない

### 同じファイルを触るタスク（並行しない）

- `src/jobs/collect.ts`: T034 → T040 → T044 → T051 の順に進める
- `src/lib/db/partitions.ts`: T021 → T054
- `prisma/schema.prisma`: T018 → T019 → T053

### 並行して進められるもの

- セットアップの [P]（T002〜T005、T007）
- 基盤のテスト（T009〜T011）と、T012〜T014、T017
- 基盤の完了後、US1 のスキーマ（T027〜T029）、US2 / US3 の純粋関数とテスト（T035、T036、T039、T041、T043）、US4 の sync-static（T045〜T050）、US5（T052〜T055）

---

## 並行実行の例: ユーザーストーリー 1

```bash
# US1 のテストを同時に書く:
タスク: "車両・予測・アラートの応答の解析テスト（tests/unit/mbta/realtime.test.ts）"
タスク: "collector の結合テスト（tests/integration/collect.test.ts）"

# US1 のスキーマを同時に実装する:
タスク: "車両の zod スキーマ（src/lib/mbta/schemas/vehicle.ts）"
タスク: "予測の zod スキーマ（src/lib/mbta/schemas/prediction.ts）"
タスク: "アラートの zod スキーマ（src/lib/mbta/schemas/alert.ts）"
```

## 並行実行の例: 基盤の完了直後

```bash
タスク: "到着検出の単体テストと実装（US2: T035, T036, T039）"
タスク: "サンプリングの単体テストと実装（US3: T041, T043）"
タスク: "sync-static（US4: T045〜T050）"
```

---

## 実装の進め方

### MVP（ユーザーストーリー 1 のみ）

1. フェーズ 1（セットアップ）を終える
2. フェーズ 2（基盤）を終える。T023 で Prisma の drift の方式を確かめる
3. フェーズ 3（US1）を終える
4. **止めて確かめる**: quickstart.md の手順で US1 を確かめる
5. 004 の dev / prod 環境ができたら、すぐ prod で collector を動かして車両位置の履歴の蓄積を始める

### 段階的な追加

1. 基盤 + US1 → prod で収集を開始（MVP）
2. US2 と US3 を追加 → 到着イベントと予測サンプルの蓄積を開始。この 2 つは後からさかのぼって作れない（予測の全件を保存していないため）ので、US1 の後できるだけ早く出す
3. US4 → 駅と路線の情報を毎日更新（それまでは手動で sync-static を 1 回実行しておく）
4. US5 → 保持期間の処理（28 日分がたまる前に出せばよい）

### `/speckit-implement` の範囲の区切り方

コンテキストがあふれないよう、1 回の実行はフェーズ単位にする（例: 「フェーズ 1 と 2 だけ実行して止まる」「T025〜T034 だけ」）。

---

## 注意

- [P] は別のファイルで、未完了のタスクに依存しないもの
- [Story] はユーザーストーリーとの対応を示す
- テストは先に書き、失敗することを確かめてから実装する
- タスクごと、またはまとまりごとにコミットする
- 実 API を呼ぶのは T007・T008・T056・T057 の記録用スクリプトだけ。テストでは呼ばない
