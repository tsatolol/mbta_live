---
description: "003 分析の実装タスク"
---

# タスク: 分析（Analytics）

**入力**: `/specs/003-analytics/` の設計文書（spec.md、plan.md、research.md、data-model.md、contracts/analytics-api.md）と `.specify/memory/constitution.md`、`docs/architecture.md`、001 の DB スキーマ（`prisma/schema.prisma`）

**前提**: plan.md（必須）、spec.md（ユーザーストーリー）、data-model.md（指標の定義）、contracts/analytics-api.md

**テスト**: spec.md のテスト要件（TR-001〜TR-005）に基づいてタスクを含める。指標の定義は TypeScript の純粋関数を表で単体テストし、同じ小さなデータで集計 SQL の結果と突き合わせる（本物の PostgreSQL）。分析 API は結合テスト、画面は Playwright の E2E。グラフは画像で比べず、グラフに渡すデータへの変換を単体テストする。

**構成**: ユーザーストーリーごとに分ける。各ストーリーは、指標の TypeScript 版（テストを先に書く）→ 集計 SQL と突き合わせのテスト → aggregate ジョブへの組み込み → 分析 API → 画面 → E2E の順に進める。

**001・002・004 との関係**: 入力は 001 の生データ（`arrival_events`、`prediction_samples`、`alerts`、`alert_routes`）と静的データ。`aggregate_runs` と aggregate ジョブ（パーティションの管理）は 001 で作り済みで、この feature で集計を足す。画面の共通部分（ヘッダー・フッター）と内部 API の作り方は 002 にそろえる。aggregate の Cloud Run Job と Scheduler は 004 で作り済み。

## 書式: `[ID] [P?] [Story] 説明`

- **[P]**: 並行して進められる（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: 対応するユーザーストーリー（US1〜US4）

---

## フェーズ 1: セットアップ（共通の土台）

**目的**: 依存の追加、集計テーブル、指標の定数

- [ ] T001 Apache ECharts（6.1.0）を依存に加える。グラフの部品は `echarts/core` から必要なものだけを読み込む: `package.json`
- [ ] T002 [P] 集計テーブルのマイグレーション（expand のみ）: `daily_headway_stats`、`daily_prediction_accuracy`、`daily_alert_stats`、`hourly_alert_minutes`。主キーは次元の列すべて、`service_date` に索引: `prisma/schema.prisma`、`prisma/migrations/`
- [ ] T003 [P] 指標の定数を足す: 運休とみなす間隔（60 分）、団子運転（2 分）、間隔の開きの倍率（2）と基準の日数（28）、±60 秒、定義の版（`AGGREGATE_DEFINITION_VERSION`。指標がそろうまでは 0）と、生データを消してよい最小の版（`MIN_DROPPABLE_DEFINITION_VERSION = 1`）、遅延系の effect の一覧: `src/lib/metrics/constants.ts`

---

## フェーズ 2: 基盤（すべてのストーリーの前提）

**目的**: 曜日種別と時間帯の計算、集計ジョブの骨組み（期間の指定・冪等・`aggregate_runs`）、分析 API の共通部分、画面の共通部分

**⚠️ 重要**: このフェーズが終わるまで、ユーザーストーリーの作業は始めない

- [ ] T004 [P] 曜日種別と時間帯の単体テスト: `dayTypeOf(serviceDate)`（平日・土曜・日曜）、`bostonHourOf(instant)`（夏時間の切り替え日を含む）、運行日の時間帯の並び（3〜23, 0〜2）: `tests/unit/time.test.ts`
- [ ] T005 [P] `dayTypeOf`、`bostonHourOf`、`SERVICE_DAY_HOURS` を書く（T004 を通す）: `src/lib/time.ts`
- [ ] T006 aggregate ジョブの骨組みの結合テスト: 前の運行日を集計して `aggregate_runs` を `success`・定義の版付きで記録する、`--from` / `--to` で古い順に集計する、同じ運行日を 2 回集計しても行が変わらない（TR-004）、集計に失敗した運行日は `failed` を記録してパーティションを消さない、パーティションの管理は集計のあとに行う: `tests/integration/aggregate.test.ts`
- [ ] T007 aggregate ジョブに集計の骨組みを書く（T006 を通す）: 運行日ごとに 1 つのトランザクションで「その日の行を消す → 指標ごとの集計を入れ直す → `aggregate_runs` を upsert」。指標ごとの集計は登録式にして、各ストーリーで足す。コマンドラインの `--from` / `--to`（`YYYY-MM-DD`）: `src/jobs/aggregate.ts`、`src/lib/db/aggregate.ts`
- [ ] T007a 生データの削除の条件に、集計の定義の版を足す（`definition_version >= MIN_DROPPABLE_DEFINITION_VERSION` の `success` だけを集計済みとみなす）。版 0 の集計（指標がそろう前）では生データを消さない。既存のテストに版 0 のケースを足す: `src/lib/db/partitions.ts`、`tests/integration/retention.test.ts`
- [ ] T008 [P] 分析 API の共通部分: `from` / `to`（運行日。既定は直近 7 日、最大 92 日）・`route`（`Green` 可）・`direction` の検証、範囲に当日が含まれるかの判定、応答の共通の項目（`definitionVersions`、`todayIncluded`、`lastAggregatedServiceDate`）のスキーマ: `src/lib/api/analytics.ts`、`src/lib/api-schemas/analytics.ts`
- [ ] T009 [P] 分析 API の共通部分の単体テスト: 期間の既定値と上限、`from > to` で 400、当日を含むかの判定: `tests/unit/api/analytics-params.test.ts`
- [ ] T010 画面の共通部分: ナビゲーションに Analytics を足し、`/analytics` から 4 つの画面へのタブ、絞り込み（期間・路線・方向）の部品、到着時刻の推定精度（±60 秒程度）の注記（FR-008）、ECharts を包む部品（ブラウザでだけ描画し、画面の幅に合わせる）: `src/app/analytics/layout.tsx`、`src/components/analytics/`、`src/components/charts/echart.tsx`、`src/components/layout/header.tsx`
- [ ] T011 [P] 分析の E2E 用のデータ: 運行日 8 日分の到着イベントと予測サンプルを、決まった規則（Red の数駅、Green の幹線の駅、団子運転と間隔の開きを含む）で作るヘルパー。結合テストと E2E のシードで共有し、E2E のシードでは aggregate ジョブで前の 7 日を集計する: `tests/helpers/analytics-seed.ts`、`tests/e2e/seed-db.ts`

**チェックポイント**: 集計の骨組みが動き、`aggregate_runs` が記録される。ユーザーストーリーを始められる

---

## フェーズ 3: ユーザーストーリー 1 - 運行間隔の乱れを見る（優先度: P1）🎯 MVP

**目標**: 路線・方向・駅・期間を選ぶと、運行間隔の推移と分布、団子運転と間隔の開きの件数が出る

**単独での確認方法**: E2E 用のシードで、運行間隔の画面に推移・分布・件数が出ることを確かめる

### ユーザーストーリー 1 のテスト

- [ ] T012 [P] [US1] 運行間隔の TypeScript 版の単体テスト（TR-001）: 連続する到着の差、60 分超の除外、団子運転（< 2 分）、間隔の開き（基準の中央値 × 2 より大きい。基準がなければ数えない）、時間帯は後の到着の時刻、統計（n・平均・p50・p90・最大）。間隔が負にならない不変条件を fast-check で: `tests/unit/metrics/headways.test.ts`
- [ ] T013 [P] [US1] 運行間隔の SQL と TypeScript 版の突き合わせ（TR-002、TR-003）: 同じ小さなデータで行が一致する。Green の幹線の合算、運行日の日付またぎ（ET 02:59 と 03:00）、夏時間の切り替え日（25 時間の日）、到着が 0 件の日: `tests/integration/analytics/headways-sql.test.ts`

### ユーザーストーリー 1 の実装

- [ ] T014 [US1] 運行間隔の TypeScript 版を書く（T012 を通す）: `src/lib/metrics/headways.ts`
- [ ] T015 [US1] 運行間隔の集計 SQL を書く（T013 を通す）: 運行日 1 つ分の SELECT。基準の中央値は前の 28 日の `daily_headway_stats.p50_sec` から。Green の幹線の駅は路線パターンから求める: `src/lib/db/analytics-sql.ts`
- [ ] T016 [US1] aggregate ジョブに運行間隔の集計を登録する。T006 のテストに運行間隔の行が入ることを足す: `src/lib/db/aggregate.ts`
- [ ] T017 [P] [US1] `GET /api/analytics/headways` の結合テスト: 日別・時間帯別の統計と件数、`route=Green`、`stop` での絞り込み、当日分を生データから計算して結合する、当日分の値と翌日に集計した値が一致する（TR-004）、`definitionVersions`、不正な値で 400: `tests/integration/api/analytics-headways.test.ts`
- [ ] T018 [US1] `GET /api/analytics/headways` を書く（T017 を通す）: `src/app/api/analytics/headways/route.ts`、`src/lib/api/analytics-headways.ts`、`src/lib/db/analytics-read.ts`
- [ ] T019 [US1] 運行間隔の画面を書く: 路線・方向・駅（その路線の駅）・期間の絞り込み、日別の p50 / p90 の推移、時間帯別の分布、団子運転と間隔の開きの件数。グラフに渡すデータへの変換は関数にして単体テストする: `src/app/analytics/headways/page.tsx`、`src/components/analytics/headway-charts.ts`、`tests/unit/analytics/headway-charts.test.ts`
- [ ] T020 [US1] 運行間隔の画面の E2E（TR-005）: 絞り込みを変えるとグラフのデータが変わる、Green の合算、件数、推定精度の注記: `tests/e2e/analytics.spec.ts`

**チェックポイント**: 運行間隔の画面が動く（MVP）

---

## フェーズ 4: ユーザーストーリー 2 - 到着予測の精度を見る（優先度: P1）

**目標**: リード時間ごとの誤差の分布と、平均誤差・平均絶対誤差・p90・±60 秒以内の割合が出て、予測の種類で絞れる

**単独での確認方法**: E2E 用のシードで、予測精度の画面にリード時間ごとの統計が出ることを確かめる

### ユーザーストーリー 2 のテスト

- [ ] T021 [P] [US2] 予測誤差の TypeScript 版の単体テスト（TR-001）: 誤差の符号（正 = 予測より遅く到着）、補間の到着の除外、到着のない予測の除外、リード時間と種類（空は `UNKNOWN`）での分割、±60 秒（境界を含む）: `tests/unit/metrics/prediction-accuracy.test.ts`
- [ ] T022 [P] [US2] 予測誤差の SQL と TypeScript 版の突き合わせ（TR-002）: `tests/integration/analytics/prediction-accuracy-sql.test.ts`

### ユーザーストーリー 2 の実装

- [ ] T023 [US2] 予測誤差の TypeScript 版を書く（T021 を通す）: `src/lib/metrics/prediction-accuracy.ts`
- [ ] T024 [US2] 予測誤差の集計 SQL を書き、aggregate ジョブに登録する（T022 を通す）: `src/lib/db/analytics-sql.ts`、`src/lib/db/aggregate.ts`
- [ ] T025 [P] [US2] `GET /api/analytics/predictions` の結合テスト: リード時間ごとの統計、`updateType` での絞り込み、当日分の結合、不正な値で 400: `tests/integration/api/analytics-predictions.test.ts`
- [ ] T026 [US2] `GET /api/analytics/predictions` を書く（T025 を通す）: `src/app/api/analytics/predictions/route.ts`、`src/lib/api/analytics-predictions.ts`、`src/lib/db/analytics-read.ts`
- [ ] T027 [US2] 予測精度の画面を書く: 路線・方向・予測の種類・期間の絞り込み、リード時間ごとの平均誤差と平均絶対誤差・p90、±60 秒以内の割合。変換の単体テスト: `src/app/analytics/predictions/page.tsx`、`src/components/analytics/prediction-charts.ts`、`tests/unit/analytics/prediction-charts.test.ts`
- [ ] T028 [US2] 予測精度の画面の E2E: `tests/e2e/analytics.spec.ts`

**チェックポイント**: US1 と US2 が動く

---

## フェーズ 5: ユーザーストーリー 3 - アラートの傾向を見る（優先度: P2）

**目標**: 路線別・effect 別・cause 別の件数と継続時間の推移が、遅延系とお知らせ系に分けて出る

### ユーザーストーリー 3 のテスト

- [ ] T029 [P] [US3] アラートの集計の TypeScript 版の単体テスト（TR-001）: その日にフィードで観測され、有効だった分数がある日だけ数える（予告だけの日は数えない）、日をまたぐ継続時間（その日に含まれる分数）、`active_period` と `first_seen_at`〜`last_seen_at` の重なり、時間帯ごとの分数、遅延系とお知らせ系の区分: `tests/unit/metrics/alert-stats.test.ts`
- [ ] T030 [P] [US3] アラートの集計 SQL と TypeScript 版の突き合わせ（TR-002）: `tests/integration/analytics/alert-stats-sql.test.ts`

### ユーザーストーリー 3 の実装

- [ ] T031 [US3] アラートの集計の TypeScript 版を書く（T029 を通す）: `src/lib/metrics/alert-stats.ts`
- [ ] T032 [US3] アラートの集計 SQL（`daily_alert_stats` と `hourly_alert_minutes`）を書き、aggregate ジョブに登録する（T030 を通す）。3 つの指標がそろうので `AGGREGATE_DEFINITION_VERSION` を 1 にする（ここから生データの削除が始まる）: `src/lib/db/analytics-sql.ts`、`src/lib/db/aggregate.ts`、`src/lib/metrics/constants.ts`
- [ ] T033 [P] [US3] `GET /api/analytics/alerts` の結合テスト: 日別の effect × cause の件数と分数、区分、`route` での絞り込み、当日分の結合: `tests/integration/api/analytics-alerts.test.ts`
- [ ] T034 [US3] `GET /api/analytics/alerts` を書く（T033 を通す）: `src/app/api/analytics/alerts/route.ts`、`src/lib/api/analytics-alerts.ts`、`src/lib/db/analytics-read.ts`
- [ ] T035 [US3] アラートの傾向の画面を書く: 遅延系とお知らせ系を分けた、日別の件数と分数の推移、effect 別・cause 別の内訳。変換の単体テスト: `src/app/analytics/alerts/page.tsx`、`src/components/analytics/alert-charts.ts`、`tests/unit/analytics/alert-charts.test.ts`
- [ ] T036 [US3] アラートの傾向の画面の E2E: `tests/e2e/analytics.spec.ts`

**チェックポイント**: US1〜US3 が動く

---

## フェーズ 6: ユーザーストーリー 4 - 曜日と時間帯のパターンを見る（優先度: P2）

**目標**: 曜日 × 時間帯（ET）のヒートマップで、運行間隔 p90・予測誤差・アラートの分数を切り替えて見られる

### ユーザーストーリー 4 のテスト

- [ ] T037 [P] [US4] ヒートマップの集約の単体テスト: 件数で重み付けした平均、アラートの分数の日あたりの平均、データのないセルは空、時間帯の並び（3〜2）: `tests/unit/metrics/heatmap.test.ts`
- [ ] T038 [P] [US4] `GET /api/analytics/heatmap` の結合テスト: 3 つの指標、`route` での絞り込み、当日分の結合、不正な `metric` で 400: `tests/integration/api/analytics-heatmap.test.ts`

### ユーザーストーリー 4 の実装

- [ ] T039 [US4] ヒートマップの集約を書く（T037 を通す）: `src/lib/metrics/heatmap.ts`
- [ ] T040 [US4] `GET /api/analytics/heatmap` を書く（T038 を通す）: `src/app/api/analytics/heatmap/route.ts`、`src/lib/api/analytics-heatmap.ts`、`src/lib/db/analytics-read.ts`
- [ ] T041 [US4] パターンの画面を書く: 指標の切り替え、曜日 × 時間帯のヒートマップ、近似であることの注記。変換の単体テスト: `src/app/analytics/patterns/page.tsx`、`src/components/analytics/heatmap-chart.ts`、`tests/unit/analytics/heatmap-chart.test.ts`
- [ ] T042 [US4] パターンの画面の E2E: `tests/e2e/analytics.spec.ts`

**チェックポイント**: すべてのユーザーストーリーが動く

---

## フェーズ 7: 仕上げと横断的な作業

- [ ] T043 dev での E2E に分析の 4 画面を足す（表示されることだけ。dev は生データが 3 日分）: `tests/e2e/dev/dev.spec.ts`
- [ ] T044 [P] 性能の確認（SC-002）: 28 日分の集計データを入れた DB で、各分析 API の応答時間を測る。遅ければ索引を足す。結果を research.md に記録する
- [ ] T045 [P] 文書を更新する（flow-back）: 契約に実際の応答の形とパラメータ、`docs/architecture.md` に分析の画面と集計テーブル、`docs/development.md` に `pnpm job:aggregate --from/--to`
- [ ] T046 確認: dev / prod で aggregate ジョブが動いて `aggregate_runs` が記録され、生データのパーティションが保持期間で消えること（これまでは集計がなく、消されずに残っていた）、`/api/health` の `previousServiceDateAggregated` が true になること、各画面が表示されることを確かめる。結果を research.md に記録する
- [ ] T047 文書とタスクの食い違いを点検し、見つかったものを反映する（`/speckit-analyze` 相当）

---

## 依存関係と実行順

### フェーズの依存関係

- **セットアップ（フェーズ 1）**: 依存なし。T002 と T003 は並行できる
- **基盤（フェーズ 2）**: セットアップの完了が前提。T004・T005、T008・T009、T011 は並行できる。T007 は T006 の後
- **US1〜US4（フェーズ 3〜6）**: 基盤の完了が前提。US4 のヒートマップは US1〜US3 の集計テーブルを読むので、最後にする
- **仕上げ（フェーズ 7）**: US1〜US4 の完了が前提

### ユーザーストーリーの依存関係

- **US1（P1）**: 基盤だけが前提。最初に作る（MVP）
- **US2（P1）**: 基盤だけが前提
- **US3（P2）**: 基盤だけが前提
- **US4（P2）**: US1〜US3 の集計が前提

### 同じファイルを触るタスク（並行しない）

- `src/lib/db/analytics-sql.ts`: T015 → T024 → T032
- `src/lib/db/aggregate.ts`: T007 → T016 → T024 → T032
- `src/lib/db/analytics-read.ts`: T018 → T026 → T034 → T040
- `tests/e2e/analytics.spec.ts`: T020 → T028 → T036 → T042

---

## 実装の進め方

### MVP（ユーザーストーリー 1 のみ）

1. セットアップと基盤（フェーズ 1〜2）。この時点で aggregate ジョブが `aggregate_runs` を記録するようになる。ただし定義の版は 0 なので、生データはまだ消さない（T007a）
2. US1（運行間隔）→ dev で確かめる
3. 以降のストーリーを順に足す。各ストーリーの完了ごとに PR を作る

### `/speckit-implement` の範囲の区切り方

コンテキストがあふれないよう、1 回の実行はフェーズ単位にする（フェーズ 1〜2、フェーズ 3、…）。

---

## 注意

- **生データの保護**: 001 の生データは、集計が成功した運行日だけ、保持期間を過ぎたら消える。指標がそろう前（版 0）の集計では消さない。フェーズごとに prod に出しても、まだ集計していない指標の元データが失われないようにするため
- 指標の定義を変えたら `AGGREGATE_DEFINITION_VERSION` を上げる。定義は data-model.md、しきい値は `src/lib/metrics/constants.ts` だけで変える
- 集計テーブルに書くのは aggregate ジョブだけ。分析 API は読むだけ（当日分も SELECT で計算するだけ）
- 時間帯と曜日は ET。運行日の計算は `src/lib/time.ts` だけ
- 集計 SQL は `$queryRaw` で書き、結果の行は zod で検証する。SQL を変えたら、TypeScript 版との突き合わせのテストを必ず通す
