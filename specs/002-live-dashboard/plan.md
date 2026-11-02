# Implementation Plan: リアルタイム画面（Live Dashboard）

**Branch**: `002-live-dashboard` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-live-dashboard/spec.md`

## Summary

Next.js の App Router で地図・駅・アラート・稼働状況の画面と、それらが使う読み取り専用の内部 API を作る。データは 001 が書き込んだ現在値テーブルと静的データを読む。

## Technical Context

**Language/Version**: TypeScript（strict）、Node.js Active LTS（24.x）

**Primary Dependencies**: Next.js（App Router）、MapLibre GL JS、TanStack Query、Tailwind CSS + shadcn/ui、Prisma Client、zod、date-fns + @date-fns/tz

**Storage**: 001 の PostgreSQL を読むだけ

**Testing**: 内部 API の結合テスト（本物の PostgreSQL + 共有の zod スキーマ）、Vitest（計算する値）、Playwright（主要な流れと状態）。要件は spec.md の Testing Requirements

**Target Platform**: Cloud Run サービス（web、`min-instances=0`）、IAP の背後

**Project Type**: Web アプリ（Next.js 一体型）

**Performance Goals**: 初回表示 3 秒以内（コールドスタートを除く p95）

**Constraints**: ブラウザから MBTA API を呼ばない。ビルド時の環境変数に環境ごとの値を入れない

**Scale/Scope**: 利用者は少数。画面 5 つ（`/`, `/stations`, `/stations/[stopId]`, `/alerts`, `/status`）

## Constitution Check

| 原則 | 適合 |
|---|---|
| I. MBTA API はジョブからだけ | ✅ 内部 API は DB だけを読む |
| II. Web は読み取り専用 | ✅ すべて GET |
| III. 入力の検証 | ✅ クエリパラメータを zod で検証 |
| IV. テスト | ✅ 4 画面に Playwright |
| V. 時刻 | ✅ API は UTC、表示時にボストン時間へ変換 |
| VI. 1 つのイメージ | ✅ 環境の表示は実行時の `APP_ENV` だけ |

## Project Structure

### Documentation (this feature)

```text
specs/002-live-dashboard/
├── spec.md
├── plan.md
├── research.md
├── contracts/
│   └── live-api.md     # 内部 API、読むテーブル、計算して返す値
└── tasks.md             # /speckit-tasks で作成
```

### Source Code (repository root)

リポジトリ全体の構成は [docs/architecture.md](../../docs/architecture.md) を参照。この feature で使う部分:

```text
src/
├── app/
│   ├── page.tsx                     # Live Map
│   ├── stations/page.tsx            # Stations
│   ├── stations/[stopId]/page.tsx   # Arrival Board
│   ├── alerts/page.tsx              # Alerts
│   ├── status/page.tsx              # System Status
│   └── api/{live,static,status,health}/...
├── components/
│   ├── map/
│   └── ui/
└── lib/db/                          # 読み取りクエリ
tests/e2e/
```

**Structure Decision**: 画面と内部 API を同じ Next.js アプリに置く。共通のヘッダー（最終更新時刻、stale バナー、環境バッジ）とフッター（出典表記）はルートの layout に置く。

## Complexity Tracking

なし
