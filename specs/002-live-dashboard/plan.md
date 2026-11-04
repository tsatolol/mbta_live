# 実装計画: リアルタイム画面（Live Dashboard）

**ブランチ**: `002-live-dashboard` | **日付**: 2026-11-01 | **仕様**: [spec.md](./spec.md)

**入力**: `/specs/002-live-dashboard/spec.md` の機能仕様

## 概要（Summary）

Next.js の App Router で地図・駅・アラート・稼働状況の画面と、それらが使う読み取り専用の内部 API を作る。データは 001 が書き込んだ現在値テーブルと静的データを読む。

## 技術的な前提（Technical Context）

**言語/バージョン**: TypeScript（strict）、Node.js Active LTS（24.x）

**主な依存関係**: Next.js（App Router）、MapLibre GL JS、TanStack Query、Tailwind CSS + shadcn/ui、Prisma Client、zod、date-fns + @date-fns/tz

**ストレージ**: 001 の PostgreSQL を読むだけ

**テスト**: 内部 API の結合テスト（本物の PostgreSQL + 共有の zod スキーマ）、Vitest（計算する値）、Playwright（主要な流れと状態）。要件は spec.md のテスト要件（Testing Requirements）

**実行環境**: Cloud Run サービス（web、`min-instances=0`）、IAP の背後

**プロジェクトの種類**: Web アプリ（Next.js 一体型）

**性能目標**: 初回表示 3 秒以内（コールドスタートを除く p95）

**制約**: ブラウザから MBTA API を呼ばない。ビルド時の環境変数に環境ごとの値を入れない

**規模/範囲**: 利用者は少数。画面 5 つ（`/`, `/stations`, `/stations/[stopId]`, `/alerts`, `/status`）

## 憲章との適合確認（Constitution Check）

| 原則 | 適合 |
|---|---|
| I. MBTA API はジョブからだけ | ✅ 内部 API は DB だけを読む |
| II. Web は読み取り専用 | ✅ すべて GET |
| III. 入力の検証 | ✅ クエリパラメータを zod で検証 |
| IV. テスト | ✅ 4 画面に Playwright、内部 API に結合テスト、計算する値に単体テスト |
| V. 時刻 | ✅ API は UTC、表示時にボストン時間へ変換 |
| VI. 1 つのイメージ | ✅ 環境の表示は実行時の `APP_ENV` だけ |

## プロジェクト構成（Project Structure）

### 文書（この feature）

```text
specs/002-live-dashboard/
├── spec.md
├── plan.md
├── research.md
├── contracts/
│   └── live-api.md     # 内部 API、読むテーブル、計算して返す値
└── tasks.md             # /speckit-tasks で作成（作成済み）
```

### ソースコード（リポジトリのルートから）

リポジトリ全体の構成は [docs/architecture.md](../../docs/architecture.md) を参照。この feature で使う部分:

```text
src/
├── app/
│   ├── layout.tsx                   # 共通のヘッダー・フッター（force-dynamic。APP_ENV を実行時に読む）
│   ├── page.tsx                     # Live Map
│   ├── stations/page.tsx            # Stations
│   ├── stations/[stopId]/page.tsx   # Arrival Board
│   ├── alerts/page.tsx              # Alerts
│   ├── status/page.tsx              # System Status
│   └── api/{live,static,status,health}/**/route.ts   # 本番の DB と時計を src/lib/api/ に渡すだけ
├── components/
│   ├── layout/                      # ヘッダー（最終更新時刻・stale バナー・DEV バッジ）、フッター
│   ├── map/                         # MapLibre の地図、ポップアップの文言
│   ├── arrivals/                    # 到着表示（方向ごとのカード、駅のアラート）
│   ├── alerts/                      # アラートのカード・まとまり・検索
│   ├── status/                      # 稼働状況の表示用の関数
│   └── ui/                          # shadcn/ui（Badge、Card、Input）
├── hooks/use-now.ts                 # 一定間隔で現在時刻を更新する
└── lib/
    ├── api/                         # 内部 API の中身（DB と時計を受け取る。結合テストが直接呼ぶ）
    ├── api-schemas/                 # 応答の zod スキーマ（サーバーと画面で共有）
    ├── db/{live,static-read,status}.ts   # 読み取りクエリ
    ├── metrics/{live,arrival-board,alerts}.ts   # 計算する値（純粋関数）
    └── geo/polyline.ts              # encoded polyline → GeoJSON
tests/
├── integration/api/                 # 内部 API の結合テスト
├── unit/{metrics,map,arrivals,alerts,status}/
├── e2e/                             # Playwright（フィクスチャを collector で取り込んだ DB）
├── e2e/dev/                         # dev での読み取りだけの E2E（IAP を通す。004 T049）
└── smoke/                           # デプロイ後のスモークテスト（004）
```

**構成の決定**: 画面と内部 API を同じ Next.js アプリに置く。共通のヘッダー（最終更新時刻、stale バナー、環境バッジ）とフッター（出典表記）はルートの layout に置く。

## 複雑さの記録（Complexity Tracking）

なし
