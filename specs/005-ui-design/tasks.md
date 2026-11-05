---
description: "005 画面デザインの刷新（Platform）の実装タスク"
---

# タスク: 画面デザインの刷新（Platform）

**入力**: `/specs/005-ui-design/` の設計文書（spec.md、plan.md、research.md、contracts/design-tokens.md、quickstart.md）と `.specify/memory/constitution.md`、`docs/architecture.md`、002・003 の画面と E2E

**前提**: plan.md（必須）、spec.md（ユーザーストーリー。2026-11-05 に明確化済み）、contracts/design-tokens.md（値の正）

**テスト**: spec.md のテスト要件（TR-001〜TR-006）に基づいてタスクを含める。表示用の計算は純粋関数にして単体テストを先に書く。新しい振る舞いは Playwright の E2E、アクセシビリティは axe-core（明るい表示と暗い表示）。見た目は画像で比べず、各ストーリーの終わりにスクリーンショットで確かめる（quickstart.md）。既存の E2E は通し続ける。意図して振る舞いを変えるもの（plan.md の「既存の振る舞いの変更」）だけ、そのストーリーの中で E2E を直す。

**構成**: ユーザーストーリーの順（US1 → US6）に進め、ストーリーごとに PR を作り、dev で確かめてから prod に出す。各ストーリーは、表示用の計算の単体テスト → 計算 → 部品 → 画面 → E2E（既存の修正と新規）→ axe → スクリーンショット の順。

**002・003 との関係**: 画面の見た目を変える。DB と集計は変えない。内部 API は `GET /api/static/stops` に路線パターンごとの駅の並びを足すだけ（T040。後方互換）。テストで使う `data-testid` は保つ（置き換える要素には同じ名前を付け直す）。

## 書式: `[ID] [P?] [Story] 説明`

- **[P]**: 並行して進められる（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: 対応するユーザーストーリー（US1〜US6）

---

## フェーズ 1: セットアップ（共通の土台）

**目的**: 依存の追加、デザイントークン、書体

- [X] T001 依存を足す: `@fontsource-variable/overpass` 5.3.0（dependencies）、`@axe-core/playwright` 4.14.0（devDependencies）: `package.json`
- [X] T002 デザイントークンを CSS 変数で定義する（contracts/design-tokens.md の値。`:root` = 明るい表示、`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` と `:root[data-theme="dark"]` = 暗い表示）。Tailwind v4 の `@theme inline` で名前を付ける。shadcn の既定の灰色のトークンは新しいトークンに置き換え、使われていない `@custom-variant dark` を消す。フォーカスの輪、`prefers-reduced-motion`、`forced-colors` の基本の決まりもここに置く: `src/app/globals.css`
- [X] T003 [P] 書体を読み込む: Overpass の可変フォント（latin と latin-ext）を `@fontsource-variable/overpass` から読み込み、`--font-sans` にする。latin のファイルを `preload` し、代わりの書体との寸法の差（`size-adjust`）を合わせる。数字の表示に `tabular-nums` の決まりを用意する: `src/app/layout.tsx`、`src/app/globals.css`

---

## フェーズ 2: 基盤（すべてのストーリーの前提）

**目的**: 表示の明るさの切り替えの仕組み、アイコン、axe の検査の仕組み、既存の部品のトークンへの置き換え

**⚠️ 重要**: このフェーズが終わるまで、ユーザーストーリーの画面の作り直しは始めない

- [X] T004 [P] 表示の選択の単体テスト（TR-003）: localStorage の値の解釈（`light` / `dark` / `system`、不正な値と読めないときは `system`）、OS の設定と選択から解決した表示（明るい / 暗い）: `tests/unit/theme.test.ts`
- [X] T005 表示の選択を書く（T004 を通す）: 純粋関数（解釈・解決）と、最初の描画の前に `data-theme` を付けるインラインのスクリプトの文字列（同じ解釈を使う）: `src/lib/theme.ts`
- [X] T006 表示の選択の仕組み: ルートの layout の `<head>` にインラインのスクリプトを置き、`<html suppressHydrationWarning>` にする。選択を読み書きするフック（`useThemePreference`）と、解決した表示を返すフック（`useResolvedTheme`。`data-theme` の変化と `matchMedia` の変化を見る）。保存できないときはエラーにしない: `src/app/layout.tsx`、`src/components/theme/use-theme.ts`
- [X] T007 [P] アイコンの部品（警告の三角、情報の丸、チェック、太陽、月、画面、メニュー、閉じる）をインラインの SVG で作る。`aria-hidden`、大きさと太さは引数: `src/components/icons.tsx`
- [X] T008 [P] axe の検査の仕組み: 画面を開き、明るい表示と暗い表示（`colorScheme` のエミュレーション）のそれぞれで、WCAG 2.2 AA のタグで検査して違反の一覧を分かりやすく出す補助。地図の canvas の扱い（research.md の「除外」）: `tests/e2e/helpers/a11y.ts`
- [X] T009 既存の共通の部品（Badge、Input、Card、`selectClass`）と、画面で色の値を直接書いている所（路線色の `#${color}` を除く）をトークンに置き換える。見た目の作り直しは各ストーリーで行い、ここでは値の置き換えだけ: `src/components/ui/`、`src/components/analytics/filter-bar.tsx` ほか
- [X] T010 [P] グラフの色を、解決した表示に合わせて明るい・暗いの値に切り替える（contracts/design-tokens.md の「グラフ」。003 で検証した配色を保つ）。グラフの部品は表示が変わったら描き直す。変換の単体テストに暗い表示の値を足す: `src/components/charts/theme.ts`、`src/components/charts/echart.tsx`、`tests/unit/analytics/*.test.ts`

**チェックポイント**: どの画面でも、トークンと書体で描かれ、OS の設定で暗い表示になる。既存の E2E がすべて通る

---

## フェーズ 3: ユーザーストーリー 1 - どの画面でも地下鉄の道具だと分かり、データの鮮度がすぐ分かる（優先度: P1）🎯 MVP

**目標**: 1 行のヘッダー、経過時間の鮮度、古いときの縞の帯、表示の切り替え、スマホのメニュー

**単独での確認方法**: どの画面でもヘッダーが 1 行（390px）で、鮮度が「n s ago」で進み、表示を切り替えられる

### ユーザーストーリー 1 のテスト

- [X] T011 [P] [US1] 経過時間の表示の単体テスト（TR-003）: 「Just now」（5 秒未満）、「12 s ago」、「3 min ago」、「1 h ago」、未来の時刻と null の扱い、古さの段階（正常 / 3 分以上で古い。002 の `isLiveDataStale` と同じ境目）: `tests/unit/display/freshness.test.ts`
- [X] T012 [P] [US1] 表示の切り替えの E2E（TR-006）: OS の設定（`colorScheme: "dark"`）で暗い表示、切り替えで変わり読み込み直しても残る、最初に描かれた時点で正しい表示（`page.addInitScript` で最初の描画の `data-theme` と背景色を記録して確かめる）、キーボードで操作でき `aria-checked` が変わる: `tests/e2e/theme.spec.ts`

### ユーザーストーリー 1 の実装

- [X] T013 [US1] 経過時間の表示を書く（T011 を通す）: `src/lib/display/freshness.ts`
- [X] T014 [US1] 鮮度の表示の部品: 点（正常 / 古い）+ 「Updated 12 s ago」（スマホは「12 s」）を毎秒更新。押すかフォーカスすると正確な時刻（ボストン時間）が出る。`data-testid="last-updated"` を保つ: `src/components/layout/freshness.tsx`
- [X] T015 [US1] 表示の切り替えの部品（`role="radiogroup"`、3 つの `role="radio"`、アイコン + 名前「Light」「Dark」「System」）: `src/components/layout/theme-toggle.tsx`
- [X] T016 [US1] データが古いときの帯: 縞（`--stripe`）+ 警告のアイコン + 文言（「Live data is 4 min old. The last successful collection was at 10:32 AM ET.」）。出たときに 1 回だけ縞を流す（動きを減らす設定では動かさない）。`data-testid="stale-banner"` と既存の文言「Live data is stale」を含める: `src/components/layout/stale-banner.tsx`
- [X] T017 [US1] ヘッダーを作り直す: 1 行（名前 + DEV のバッジ + 画面の切り替え + 鮮度 + 表示の切り替え）。幅 768px 未満では画面の切り替えと表示の切り替えをメニュー（`aria-expanded`、Esc で閉じる、フォーカスを戻す）に入れる。今の画面は文字の太さと下線の帯で示す。`env-badge` を保つ: `src/components/layout/header.tsx`、`src/components/layout/mobile-menu.tsx`
- [X] T018 [US1] フッターと、画面の見出しの決まり（`--text-lg` 800、字間 −0.01em）と本文の最大幅をそろえる。`footer` の文言は変えない: `src/components/layout/footer.tsx`、`src/app/layout.tsx`
- [X] T019 [US1] 既存の共通部分の E2E を新しいヘッダーに合わせる（最終更新が経過時間になる、stale の帯）。スマホ（390px）でヘッダーの高さが 64px 以下（SC-001）を足す: `tests/e2e/layout.spec.ts`
- [X] T020 [US1] axe の検査を足す（TR-004）: まずヘッダーとフッター（どの画面でも出るもの）を、稼働状況の画面で明るい・暗いの両方: `tests/e2e/a11y.spec.ts`
- [X] T021 [US1] スクリーンショットで確かめる（quickstart.md の 2〜4）。気づいたことを research.md に残す

**チェックポイント**: 共通の土台がそろう（MVP。ここで PR を作り、dev で確かめる）

---

## フェーズ 4: ユーザーストーリー 2 - 地図を主役にして、路線ごとの列車の数も見る（優先度: P1）

**目標**: 地図がヘッダーの下を全部使い、凡例で路線を切り替えられ、路線ごとの列車の数が出る。暗い表示の地図

### ユーザーストーリー 2 のテスト

- [ ] T022 [P] [US2] 路線ごとの列車の数の単体テスト（TR-003）: 路線の並び順、列車のない路線は 0、更新の止まった列車も数える、合計: `tests/unit/display/line-counts.test.ts`

### ユーザーストーリー 2 の実装

- [ ] T023 [US2] 路線ごとの列車の数を書く（T022 を通す）: `src/lib/display/line-counts.ts`
- [ ] T024 [US2] 凡例の部品: 路線ごとの行（帯 + 名前 + 数）を切り替えのボタン（`aria-pressed`、`data-testid="route-filter-<id>"` を保つ）にする。選んでいない路線は帯を中抜きにし、文字を `--ink-muted` に。合計の列車の数（`data-testid="vehicle-count"` を保つ）。スマホでは地図の下の閉じた帯（「Lines」+ 合計）で、押すと開く: `src/components/map/line-legend.tsx`
- [ ] T025 [US2] 地図を作り直す: 解決した表示で `positron` / `dark` のスタイルを選び、表示が変わったら `setStyle` してソースとレイヤーを足し直す（初期化を関数にまとめる）。路線を太く（5px）、列車の印を大きく（1.3 倍）、印に `--panel` の縁。色はトークンの路線色（暗い表示の値）と `--line-stale`: `src/components/map/live-map.tsx`
- [ ] T026 [US2] 地図の画面の配置: 地図がヘッダーとフッターの 1 行を除いた高さ（`100dvh`）を全部使う。凡例はデスクトップで地図の左、スマホで地図の下。運行時間外の表示（`data-testid="out-of-service"` を保つ）は地図の上に重ねる。取得の失敗の文言（何が起きて、どうなるか）: `src/app/page.tsx`
- [ ] T027 [US2] 地図の E2E を凡例に合わせる（`route-filter-<id>` の場所が変わる）。凡例の路線ごとの数が車両の数と合う、デスクトップで地図の高さが表示できる領域の 85% 以上（SC-002）、暗い表示で地図のスタイルが `dark` になる（スタイルの取得の URL を見る）を足す: `tests/e2e/map.spec.ts`
- [ ] T028 [US2] axe の検査に地図の画面を足す（明るい・暗い）: `tests/e2e/a11y.spec.ts`
- [ ] T029 [US2] スクリーンショットで確かめる。dev では OpenFreeMap の Dark のスタイルで路線と列車の印が埋もれないかを見る（research.md の未解決）

**チェックポイント**: US1 と US2 が動く

---

## フェーズ 5: ユーザーストーリー 3 - 駅の到着表示を、ホームの発車標のように読む（優先度: P1）

**目標**: 濃い板に、方向ごとの次の 3 本の残り時間を大きく琥珀色で。残り時間の表し方は 1 つ

### ユーザーストーリー 3 のテスト

- [ ] T030 [P] [US3] 残り時間の表示の単体テスト（TR-003）: 2 分以上は「n min」（切り捨て）、2 分未満は「1:23」、0 秒以下は「Now」、過ぎた便は出さない（今の `countdownLabel` / `countdownClock` を置き換える）: `tests/unit/arrivals/format.test.ts`

### ユーザーストーリー 3 の実装

- [ ] T031 [US3] 残り時間の表示を書く（T030 を通す）: `src/components/arrivals/format.ts`
- [ ] T032 [US3] 発車標の板の部品: 方向ごとの行（路線色の帯、行先、「Red Line, southbound」、次の 3 本の残り時間 `--countdown` `--text-2xl` と到着時刻、始発駅の「departs」、運休の取り消し線と「Cancelled」）。今の `data-testid`（`direction-<route>-<dir>`、`arrival`、`data-trip-id`、`data-cancelled`、`arrival-cancelled`、`no-arrivals`）を保ち、残り時間は `arrival-countdown` の 1 つにまとめる（`arrival-clock` はなくす）: `src/components/arrivals/departure-board.tsx`
- [ ] T033 [US3] 駅のアラートの表示を作り直す: 遅延系は縞 + 警告のアイコン + 「Disruption」、お知らせ系は情報のアイコン + 「Notice」。板の前に出す（`station-alerts`、`station-alert` を保つ）: `src/components/arrivals/station-alerts.tsx`
- [ ] T034 [US3] 駅のページを作り直す: パンくず「Stations / Park Street」（矢印を使わない）、駅名（`--text-xl`）と通る路線の帯、アラート、板。「Station not found」の文言に、駅の一覧への道を添える: `src/app/stations/[stopId]/page.tsx`
- [ ] T035 [US3] 駅の E2E を直す（plan.md の「既存の振る舞いの変更」）: 毎秒のカウントダウンは、Playwright の時計を進めて「n min」が減ること、2 分未満の便の秒が減ることで確かめる。残り時間の要素が 1 便に 1 つ: `tests/e2e/stations.spec.ts`
- [ ] T036 [US3] axe の検査に駅のページを足す（明るい・暗い）。残り時間が画面で最も大きい文字（SC-004）を E2E で確かめる（計算した `font-size` を比べる）: `tests/e2e/a11y.spec.ts`、`tests/e2e/stations.spec.ts`
- [ ] T037 [US3] スクリーンショットで確かめる（デスクトップ・スマホ、明るい・暗い）

**チェックポイント**: US1〜US3（P1）がそろう

---

## フェーズ 6: ユーザーストーリー 4 - 駅を路線図の上で探す（優先度: P2）

**目標**: 路線ごとの路線図（駅の並びと分岐）。Green は 1 つにまとめ、幹線の駅は 1 回だけ

### ユーザーストーリー 4 のテスト

- [ ] T038 [P] [US4] 路線図の組み立ての単体テスト（TR-003）: 1 本の路線（Orange）、末端で分かれる（Red の Ashmont / Braintree）、両端で分かれ途中で複数回分かれる（Green: 北の Medford/Tufts と Union Square、Copley での E、Kenmore での B・C・D）、すべての駅が 1 回ずつ出る、区間の順が停車順と矛盾しない: `tests/unit/display/strip-map.test.ts`

### ユーザーストーリー 4 の実装

- [ ] T039 [US4] 路線図の組み立てを書く（T038 を通す）: `src/lib/display/strip-map.ts`
- [ ] T040 [US4] 駅の一覧の API に、路線パターンごとの駅の並び（`patterns`: 路線・パターン ID・親駅 ID の並び。方向 0 の canonical なもの）を足す。今の `GET /api/static/stops` は Red の Ashmont と Braintree の並びを 1 つにつないで返すので、どこで分かれるかが分からないため。項目を足すだけ（後方互換）。先に 002 の契約を直し、結合テストを足す: `specs/002-live-dashboard/contracts/live-api.md`、`src/lib/api-schemas/stops.ts`、`src/lib/db/static-read.ts`、`src/lib/api/static-stops.ts`、`tests/integration/api/static-stops.test.ts`
- [ ] T041 [US4] 路線図の部品: 縦の路線色の線と駅の点、分岐は横に並べた列。駅名は駅のページへのリンク（`station-link-<id>` を保つ）。検索に該当する駅を強調し、ほかを `--ink-muted` に: `src/components/stations/line-diagram.tsx`
- [ ] T042 [US4] 駅の一覧の画面を作り直す: 検索、路線図の並び（デスクトップは列、スマホは縦）。`station-group-<route>` は路線図ごと（Green は `station-group-Green`）。該当する駅がないときの文言（`no-stations` を保つ）: `src/app/stations/page.tsx`
- [ ] T043 [US4] 駅の E2E を直す（Park Street は Red と Green の 2 つの路線図に出る）。Green の幹線の駅が 1 回だけ、検索の強調、デスクトップで縦の長さが 1,350px 以下（SC-003）を足す: `tests/e2e/stations.spec.ts`
- [ ] T044 [US4] axe の検査に駅の一覧を足す（明るい・暗い）: `tests/e2e/a11y.spec.ts`
- [ ] T045 [US4] スクリーンショットで確かめる。高さが目標に届かなければ、配置を見直して research.md に残す

**チェックポイント**: US1〜US4 が動く

---

## フェーズ 7: ユーザーストーリー 5 - アラートと稼働状況の重要度を、色だけに頼らずに読む（優先度: P2）

- [ ] T046 [P] [US5] 稼働状況の一文の単体テスト（TR-003）: 正常、最後の成功が古い、直近の失敗がある、まだ一度も動いていない: `tests/unit/display/status-summary.test.ts`
- [ ] T047 [US5] 稼働状況の一文を書く（T046 を通す）: `src/lib/display/status-summary.ts`
- [ ] T048 [US5] アラートの画面を作り直す: カードをやめて細い線で区切った一覧、遅延系は縞 + 警告のアイコン + 「Disruption」、お知らせ系は情報のアイコン + 「Notice」、路線は小さな帯 + 名前。予告の区画と検索は今の振る舞いを保つ（`active-alerts`、`upcoming-alerts`、`alert-card`、`alert-search` など）: `src/app/alerts/page.tsx`、`src/components/alerts/`
- [ ] T049 [US5] 稼働状況の画面を作り直す: 上に状態の一文とアイコン（`status-summary`）、表はその下（`job-*`、`table-*` を保つ）: `src/app/status/page.tsx`
- [ ] T050 [US5] E2E を足す: アラートの重要度が文言とアイコンで分かる（遅延系に「Disruption」）、稼働状況の一文: `tests/e2e/alerts.spec.ts`、`tests/e2e/status.spec.ts`
- [ ] T051 [US5] axe の検査にアラートと稼働状況を足す（明るい・暗い）。スクリーンショットで確かめる: `tests/e2e/a11y.spec.ts`

---

## フェーズ 8: ユーザーストーリー 6 - 分析の要点を文章で読んでから、グラフを見る（優先度: P3）

- [ ] T052 [P] [US6] 分析の要点の文の単体テスト（TR-003）: 運行間隔・予測精度・アラート・パターンの 4 つ、データがないとき、単数と複数（「1 gap」「16 gaps」）: `tests/unit/display/summaries.test.ts`
- [ ] T053 [US6] 分析の要点の文を書く（T052 を通す）: `src/lib/display/summaries.ts`
- [ ] T054 [US6] 分析の画面の上部を作り直す: 数字のタイルを要点の一文に置き換え、文の中の数字に今の `stat-…-value` を付ける。グラフは枠に入れず、見出しと余白で区切る。絞り込みと注記（`precision-note`、`aggregation-note`）は保つ: `src/app/analytics/*/page.tsx`、`src/components/analytics/`
- [ ] T055 [US6] 分析の E2E を直す（タイルがなくなる）。要点の一文が絞り込みで変わる（TR-002）を足す: `tests/e2e/analytics.spec.ts`
- [ ] T056 [US6] axe の検査に分析の 1 画面（運行間隔）を足す（明るい・暗い）。ヒートマップの暗い表示の段階を確かめる。スクリーンショットで確かめる: `tests/e2e/a11y.spec.ts`

**チェックポイント**: すべてのユーザーストーリーが動く

---

## フェーズ 9: 仕上げと横断的な作業

- [ ] T057 dev での E2E に、暗い表示で主要な画面が表示されることを足す（地図のタイルの Dark のスタイルの読み込みを含む）: `tests/e2e/dev/dev.spec.ts`
- [ ] T058 [P] 初回表示（SC-006）を確かめる: dev での E2E の「初回表示」が 3 秒以内のまま（書体の読み込みで悪化していない）。結果を research.md に残す
- [ ] T059 [P] 色覚の多様性と forced-colors を確かめる（quickstart.md の 4）。結果を research.md に残す
- [ ] T060 [P] 文書を更新する（flow-back）: `docs/architecture.md`（デザイントークン、表示の切り替え、画面の構成）、`docs/development.md`（axe の検査、スクリーンショットの撮り方）、002 の spec / plan で変わった振る舞い（残り時間の表し方、駅の一覧）
- [ ] T061 確認: dev / prod で、明るい・暗い表示と切り替え、スマホの表示を確かめる
- [ ] T062 文書とタスクの食い違いを点検し、見つかったものを反映する（`/speckit-analyze` 相当）

---

## 依存関係と実行順

### フェーズの依存関係

- **セットアップ（フェーズ 1）**: 依存なし。T003 は T001 の後
- **基盤（フェーズ 2）**: セットアップの完了が前提。T004・T007・T008・T010 は並行できる。T006 は T005 の後
- **US1〜US6（フェーズ 3〜8）**: 基盤の完了が前提。US1（共通のヘッダー）を最初にする。US2〜US6 は互いに独立しているが、`tests/e2e/a11y.spec.ts` を共有するので、そのファイルを触るタスクは順に進める
- **仕上げ（フェーズ 9）**: US1〜US6 の完了が前提

### ユーザーストーリーの依存関係

- **US1（P1）**: 基盤だけが前提。最初に作る（MVP）
- **US2・US3（P1）**: US1 のヘッダーの高さ（地図の高さの計算）と鮮度の部品を使う
- **US4・US5・US6（P2・P3）**: 基盤と US1 が前提

### 同じファイルを触るタスク（並行しない）

- `src/app/globals.css`: T002 → T003
- `src/app/layout.tsx`: T003 → T006 → T018
- `tests/e2e/a11y.spec.ts`: T020 → T028 → T036 → T044 → T051 → T056
- `tests/e2e/stations.spec.ts`: T035 → T036 → T043
- `src/components/arrivals/format.ts`: T031（今の関数を置き換える）

### 並行して進められるもの

- 表示用の計算の単体テスト（T011、T022、T030、T038、T046、T052）
- 基盤の T004・T007・T008・T010

---

## 実装の進め方

### MVP（ユーザーストーリー 1 まで）

1. セットアップと基盤（フェーズ 1〜2）: 書体とトークンが入り、OS の設定で暗い表示になる
2. US1（共通のヘッダーと表示の切り替え）→ PR → dev で確かめる → prod
3. 以降、US2 → US3 → US4 → US5 → US6 の順に、ストーリーごとに PR を作る

### `/speckit-implement` の範囲の区切り方

コンテキストがあふれないよう、1 回の実行はフェーズ単位にする（フェーズ 1〜2、フェーズ 3、…）。

---

## 注意

- 色・大きさ・間隔の値は contracts/design-tokens.md だけで決める。部品の中に値を書かない（路線色も CSS 変数で）
- 路線色は文字に使わない（research.md）。強調の色（琥珀）は到着表示の残り時間だけ
- 重要度は縞 + アイコン + 文言。色だけで区別させない
- 画面は英語、sentence case。大文字だけのラベル、見出しの上の小さなラベル、リンクの矢印は使わない
- テストで使う `data-testid` は保つ。意図して振る舞いを変える E2E は、plan.md に書いたものだけ
- 各ストーリーの終わりに、デスクトップとスマホ、明るい表示と暗い表示のスクリーンショットで確かめる
