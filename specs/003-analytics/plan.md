# 実装計画: 分析（Analytics）

**ブランチ**: `003-analytics` | **日付**: 2026-11-01 | **仕様**: [spec.md](./spec.md)

**入力**: `/specs/003-analytics/spec.md` の機能仕様

## 概要（Summary）

毎日 04:30 ET に aggregate ジョブで前の運行日の運行間隔・予測精度・アラートを集計テーブルに書き込み、001 の生データのパーティションを管理する。4 つの分析画面と、それが使う読み取り専用の API を作る。

## 技術的な前提（Technical Context）

**言語/バージョン**: TypeScript（strict）、Node.js Active LTS（24.x）、SQL（PostgreSQL 16）

**主な依存関係**: Prisma（`$queryRaw` + zod）、Apache ECharts 6、TanStack Query、Next.js、zod

**ストレージ**: 001 の生データを読み、集計テーブルに書く

**テスト**: Vitest（指標の TypeScript 版）、本物の PostgreSQL での集計 SQL と TypeScript 版の突き合わせ、Playwright（4 画面）。要件は spec.md のテスト要件（Testing Requirements）

**実行環境**: Cloud Run Job（aggregate）+ Cloud Run サービス（web）

**プロジェクトの種類**: Web アプリ（Next.js 一体型）+ バッチジョブ

**性能目標**: 日次集計は 05:00 ET までに完了。28 日分の範囲で画面表示 3 秒以内

**制約**: Cloud SQL の最小構成。重い計算は集計ジョブで済ませ、画面は集計テーブルを読む

**規模/範囲**: 到着イベント 約 4 万件/日、予測サンプル 約 20 万件/日

## 憲章との適合確認（Constitution Check）

| 原則 | 適合 |
|---|---|
| II. 書き込みはジョブだけ | ✅ 集計テーブルに書くのは aggregate ジョブだけ |
| IV. 純粋関数とテスト | ✅ 指標の定義を `src/lib/metrics/` の純粋関数でも実装し、SQL の結果と突き合わせるテストを書く |
| V. 時刻 | ✅ `hour` と曜日は ET で計算。運行日の計算は `src/lib/time.ts` |

## プロジェクト構成（Project Structure）

### 文書（この feature）

```text
specs/003-analytics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── analytics-api.md
└── tasks.md             # /speckit-tasks で作成
```

### ソースコード（リポジトリのルートから）

リポジトリ全体の構成は [docs/architecture.md](../../docs/architecture.md) を参照。この feature で使う部分:

```text
src/
├── jobs/aggregate.ts
├── lib/db/analytics-sql.ts           # 集計クエリ（運行日 1 つ分の SELECT。ジョブと当日分の計算で共有）
├── lib/metrics/                     # 指標の定義（純粋関数）+ constants.ts
├── app/analytics/{headways,predictions,alerts,patterns}/page.tsx
├── app/api/analytics/...
└── components/charts/
tests/unit/metrics/
```

**構成の決定**: 集計は SQL（`$queryRaw`）で DB 内で行う。同じ定義を TypeScript の純粋関数でも持ち、小さなフィクスチャで両者の結果が一致することをテストする（定義のずれを防ぐため）。

## 複雑さの記録（Complexity Tracking）

| 原則からの逸脱 | 必要な理由 | より単純な案を採らなかった理由 |
|---|---|---|
| 指標の定義を SQL と TypeScript の両方に持つ | 集計は DB 内で行う必要があり、定義はテストで検証したい | SQL だけだと単体テストしにくい。TypeScript だけだと 1 日 20 万行をアプリに読み込むことになる |
