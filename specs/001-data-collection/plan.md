# 実装計画: データ収集（Data Collection）

**ブランチ**: `001-data-collection` | **日付**: 2026-11-01 | **仕様**: [spec.md](./spec.md)

**入力**: `/specs/001-data-collection/spec.md` の機能仕様

## 概要（Summary）

MBTA V3 API から対象 8 路線の車両・予測・アラートを定期的に取得する collector ジョブと、路線・駅・路線パターンを毎日同期する sync-static ジョブを作る。取得のたびに現在値を入れ替え、実到着の推定と予測のサンプリングを行って履歴に残す。生データは日ごとのパーティションに入れ、保持期間を過ぎたら削除する。

システム全体の構成は [docs/architecture.md](../../docs/architecture.md) を参照。

## 技術的な前提（Technical Context）

**言語/バージョン**: TypeScript（strict）、Node.js Active LTS（24.x）

**主な依存関係**: Prisma ORM（`@prisma/adapter-pg` + `pg`）、zod、date-fns + @date-fns/tz

**ストレージ**: PostgreSQL 16（Cloud SQL）。履歴テーブルは宣言的パーティショニング

**テスト**: Vitest + fast-check（単体・プロパティベース）、本物の PostgreSQL 16 を使う結合テスト、連続ポーリングの記録を流す再生テスト（`tests/replay/`）。MBTA API は `tests/fixtures/mbta/` のフィクスチャ。要件は spec.md のテスト要件（Testing Requirements）

**実行環境**: Cloud Run Jobs（`us-east4`）。起動は Cloud Scheduler（`America/New_York`）

**プロジェクトの種類**: Web アプリ（Next.js）と同じリポジトリ・同じイメージに入るバッチジョブ

**性能目標**: 収集 1 回 50 秒未満（Job のタスクタイムアウト 50 秒、リトライ 0）

**制約**: MBTA API は 1 環境あたり 5 req/分以下。キーなしの上限は送信元 IP 単位 20 req/分

**規模/範囲**: 車両 約 150 両、予測 数百〜数千件/回、到着イベント 約 4 万件/日

## 憲章との適合確認（Constitution Check）

| 原則 | 適合 |
|---|---|
| I. MBTA API はジョブからだけ | ✅ collector / sync-static だけが呼ぶ。予算は contracts/mbta-api.md |
| II. 書き込みはジョブだけ | ✅ |
| III. 入力の検証 | ✅ 応答は zod でパースし、合わない行はスキップ |
| IV. 純粋関数とテスト | ✅ 到着検出・サンプリング・運行日の計算を `src/lib/metrics/`・`src/lib/time.ts` の純粋関数にする |
| V. 時刻の一元化 | ✅ |
| VI. 1 つのイメージ | ✅ Web と同じイメージで、起動コマンドだけを変える |
| VII. 後方互換のマイグレーション | ✅ |

## プロジェクト構成（Project Structure）

### 文書（この feature）

```text
specs/001-data-collection/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── mbta-api.md
└── tasks.md             # /speckit-tasks で作成
```

### ソースコード（リポジトリのルートから）

リポジトリ全体の構成は [docs/architecture.md](../../docs/architecture.md) を参照。この feature で使う部分:

```text
prisma/                      # schema.prisma, migrations/（パーティションは手書き SQL）
src/
├── lib/mbta/                # API クライアント、zod スキーマ、変換、constants.ts
├── lib/db/
├── lib/metrics/             # 到着検出・サンプリング
├── lib/clock.ts
├── lib/time.ts
└── jobs/{collect,sync-static}.ts
tests/{unit,integration,replay}/
tests/fixtures/mbta/
```

**構成の決定**: ジョブは `src/jobs/` に置き、Web と同じイメージにバンドルする。現在時刻は `src/lib/clock.ts` から取り、テストで差し替えられるようにする。

## 複雑さの記録（Complexity Tracking）

| 原則からの逸脱 | 必要な理由 | より単純な案を採らなかった理由 |
|---|---|---|
| パーティションを手書き SQL で管理 | 28 日分の生データを速く・肥大化させずに削除するため | `DELETE` は遅く、テーブルが肥大化する。Prisma のスキーマでは表現できない |
