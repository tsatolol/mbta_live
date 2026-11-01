# CLAUDE.md — mbta_live

MBTA V3 API を使い、ボストン地下鉄（Rapid Transit 8 路線）の運行状況をリアルタイムで監視し、収集データを蓄積して運行品質（運行間隔・予測精度・アラート傾向）を分析するダッシュボード。

このリポジトリは [GitHub Spec Kit](https://github.com/github/spec-kit) の構成で仕様を管理している。**コードを書く前に、constitution と該当する feature の文書を読むこと。** 仕様を変えるときは、先に文書を更新してから実装する。

## 文書の場所

| 文書 | 内容 |
|---|---|
| `.specify/memory/constitution.md` | プロジェクト全体の原則（必ず守る） |
| `specs/001-data-collection/` | 収集ジョブ（collector / sync-static）、DB スキーマ、到着検出、MBTA API の利用方法と実測した応答の性質（`contracts/mbta-api.md`） |
| `specs/002-live-dashboard/` | 地図・駅・アラート・稼働状況の画面と内部 API |
| `specs/003-analytics/` | 日次集計と 4 つの分析画面、指標の定義 |
| `specs/004-infra-cicd/` | dev / prod の GCP 環境、Terraform、パイプライン（CI 1 回 → CD dev → 承認 → CD prod） |

各 feature のディレクトリには `spec.md`（何を・なぜ）、`plan.md`（どう作るか）、`research.md`（決定と理由）、`data-model.md`、`contracts/`、`quickstart.md` がある。`tasks.md` は `/speckit-tasks` で作る。リポジトリ全体のディレクトリ構成は `specs/001-data-collection/plan.md` にある。

## 最重要ルール（詳細は constitution）

- MBTA API を呼ぶのは収集ジョブだけ。Web とブラウザは DB だけを読む。1 環境あたり 5 req/分以下
- DB に書くのはジョブだけ。Web は読み取り専用
- 外部入力は zod で検証する。`any` は使わない
- 指標の計算は `src/lib/metrics/` の純粋関数にしてテストする
- 時刻は UTC で保存し、表示だけ `America/New_York`。運行日の計算は `src/lib/time.ts` だけ
- イメージは 1 つ。環境ごとの違いは実行時の環境変数だけで表す
- マイグレーションは後方互換（expand → contract）
- リポジトリは public。秘密の値をコミットしない、ログに出さない

## 技術スタック

Next.js（App Router, TypeScript）/ Prisma ORM + PostgreSQL 16（Cloud SQL）/ Cloud Run（web + Jobs）, `us-east4` / MapLibre GL JS + OpenFreeMap / TanStack Query / Tailwind CSS + shadcn/ui / Apache ECharts / Vitest + Playwright / Terraform + GitHub Actions（WIF）/ pnpm, Node.js 24.x

## コマンド（予定）

```bash
docker compose up -d db        # ローカル PostgreSQL
pnpm install                   # prisma generate も実行される
pnpm db:migrate                # prisma migrate deploy
pnpm db:migrate:dev            # スキーマ変更後にマイグレーションを作成
pnpm dev                       # http://localhost:3000
pnpm job:collect               # collector を 1 回（実 API。連打しない。普段は MBTA_FIXTURE_MODE=1）
pnpm job:sync-static
pnpm job:aggregate
pnpm lint && pnpm typecheck && pnpm test   # push の前に必ず実行（PR では CI が走らない）
pnpm test:e2e
pnpm fixtures:record           # 実 API からフィクスチャを記録
```

## spec-kit の使い方

- 初回のセットアップ（未実施）: `uv tool install specify-cli` → リポジトリのルートで `specify init --here --force --integration claude`。`.specify/templates/`, `.specify/scripts/` と Claude Code 用のスキル（`.claude/skills/speckit-*/SKILL.md`）が追加される。`--force` は既存のファイルを置き換えうるので、実行前にコミットしておき、差分を確認する（`.specify/memory/constitution.md` が上書きされていたら戻す）
- 流れ: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`
- 大きな feature の `/speckit-implement` は、フェーズやタスク番号で範囲を区切って実行する（コンテキストがあふれるのを防ぐため）
- 下の SPECKIT ブロックは、`specify extension add agent-context` を入れると `/speckit-agent-context-update` で自動更新される。入れない場合は手で更新する

## 未決事項

- dev / prod の GCP プロジェクト ID、請求先アカウント、予算額
- prod の承認者（現状はリポジトリのオーナーのみを想定）
- MBTA API キーの取得（dev 用・prod 用）
- 独自ドメインを使うか
- 平日の日中ピークの `/predictions` の件数とサイズ（日曜早朝は 416 件、非圧縮 251KB）
- Prisma で、パーティションの子テーブルを別スキーマに置いたときに `migrate dev` が drift を出さないか
- 団子運転・間隔の開きのしきい値
- 時刻表との比較による遅延指標を作るか
- 将来の改善候補: API キーを取得したら収集を 30 秒間隔にする（到着検出の精度向上）、アラート通知

<!-- SPECKIT START -->
現在の計画: 実装の順番は 001 → 004（prod で収集を早く始めるため）→ 002 → 003。
各 feature の計画は `specs/<feature>/plan.md` を参照。
<!-- SPECKIT END -->
