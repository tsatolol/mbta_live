# Implementation Plan: 分析（Analytics）

**Branch**: `003-analytics` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-analytics/spec.md`

## Summary

毎日 04:30 ET に aggregate ジョブで前の運行日の運行間隔・予測精度・アラートを集計テーブルに書き込み、001 の生データのパーティションを管理する。4 つの分析画面と、それが使う読み取り専用の API を作る。

## Technical Context

**Language/Version**: TypeScript（strict）、Node.js Active LTS（24.x）、SQL（PostgreSQL 16）

**Primary Dependencies**: Prisma（TypedSQL）、Apache ECharts、TanStack Query、Next.js、zod

**Storage**: 001 の生データを読み、集計テーブルに書く

**Testing**: Vitest（指標の計算関数）、Playwright（4 画面）

**Target Platform**: Cloud Run Job（aggregate）+ Cloud Run サービス（web）

**Project Type**: Web アプリ（Next.js 一体型）+ バッチジョブ

**Performance Goals**: 日次集計は 05:00 ET までに完了。28 日分の範囲で画面表示 3 秒以内

**Constraints**: Cloud SQL の最小構成。重い計算は集計ジョブで済ませ、画面は集計テーブルを読む

**Scale/Scope**: 到着イベント 約 4 万件/日、予測サンプル 約 20 万件/日

## Constitution Check

| 原則 | 適合 |
|---|---|
| II. 書き込みはジョブだけ | ✅ 集計テーブルに書くのは aggregate ジョブだけ |
| IV. 純粋関数とテスト | ✅ 指標の定義を `src/lib/metrics/` の純粋関数でも実装し、SQL の結果と突き合わせるテストを書く |
| V. 時刻 | ✅ `hour` と曜日は ET で計算。運行日の計算は `src/lib/time.ts` |

## Project Structure

### Documentation (this feature)

```text
specs/003-analytics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── analytics-api.md
└── tasks.md             # /speckit-tasks で作成
```

### Source Code (repository root)

リポジトリ全体の構成は `specs/001-data-collection/plan.md` を参照。この feature で使う部分:

```text
prisma/sql/                          # 集計クエリ（TypedSQL）
src/
├── jobs/aggregate.ts
├── lib/metrics/                     # 指標の定義（純粋関数）+ constants.ts
├── app/analytics/{headways,predictions,alerts,patterns}/page.tsx
├── app/api/analytics/...
└── components/charts/
tests/unit/metrics/
```

**Structure Decision**: 集計は SQL（TypedSQL）で DB 内で行う。同じ定義を TypeScript の純粋関数でも持ち、小さなフィクスチャで両者の結果が一致することをテストする（定義のずれを防ぐため）。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 指標の定義を SQL と TypeScript の両方に持つ | 集計は DB 内で行う必要があり、定義はテストで検証したい | SQL だけだと単体テストしにくい。TypeScript だけだと 1 日 20 万行をアプリに読み込むことになる |
