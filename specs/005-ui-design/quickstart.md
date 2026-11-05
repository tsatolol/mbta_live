# クイックスタート: 画面デザインの刷新（Platform）を確かめる

各ユーザーストーリーの完了時に、次の順で確かめる。

## 1. テスト

```bash
pnpm lint && pnpm typecheck && pnpm test   # 表示用の計算の単体テストを含む
pnpm test:e2e                              # 既存の E2E + 表示の切り替え（theme.spec.ts）+ axe（a11y.spec.ts）
```

axe の検査は、明るい表示と暗い表示の両方で、WCAG 2.2 AA の違反が 0 であること（SC-005）。

## 2. スクリーンショットで見る

E2E 用の DB に analytics シナリオを入れて、本番と同じビルドを起動する。

```bash
pnpm e2e:seed analytics
pnpm build && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mbta_live_e2e APP_ENV=dev pnpm start --port 3200
```

次の画面を、デスクトップ（1280 × 860）とスマホ（390 × 844）、明るい表示と暗い表示で撮って見る（Playwright の `colorScheme` で OS の設定をまねる）。気づいたことは research.md に残す。

| 画面 | 見るところ |
|---|---|
| `/` | 地図がヘッダーの下を全部使う（SC-002）。凡例の列車の数。スマホのヘッダーが 1 行（SC-001）|
| `/stations` | 路線図の分岐、Green の幹線が 1 回、検索の強調、縦の長さ（SC-003） |
| `/stations/place-pktrm` | 残り時間が最も大きい文字（SC-004）。運休・始発駅の表示 |
| `/alerts`, `/status` | 縞とアイコンと文言で重要度が分かる |
| `/analytics/headways`, `/analytics/patterns` | 要点の一文。グラフの暗い表示 |

## 3. 表示の切り替え

1. OS の設定を暗い表示にして（Playwright なら `colorScheme: "dark"`）開く → 暗い表示で出て、明るい表示が一瞬も出ない
2. ヘッダーの切り替えで「Light」を選ぶ → すぐに明るくなる。読み込み直しても明るいまま
3. 「System」に戻す → OS の設定に合わせる
4. キーボードだけで切り替えられ、今の選択が読み上げられる

## 4. 色覚の多様性

Chrome の DevTools の Rendering → Emulate vision deficiencies（Protanopia・Deuteranopia・Achromatopsia）で、路線・アラートの重要度・凡例の選択の状態・データが古いときの帯が区別できることを確かめる。forced-colors（Emulate CSS media feature forced-colors: active）でも同じ。
