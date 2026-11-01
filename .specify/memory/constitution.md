# mbta_live Constitution

ボストン地下鉄（MBTA Rapid Transit）の運行を監視・分析するダッシュボード「mbta_live」の開発原則。すべての spec / plan / tasks / 実装はこの原則に従う。

## Core Principles

### I. MBTA API はサーバー側のジョブからだけ呼ぶ（NON-NEGOTIABLE）

- MBTA V3 API を呼んでよいのは、バッチジョブ（collector / sync-static）だけ。Web アプリとブラウザは MBTA API を直接呼ばず、DB だけを読む
- MBTA API へのリクエストは、1 つの環境あたり**常に 5 req/分以下**に収める。新しいエンドポイントを使う、または頻度を上げるときは、`specs/001-data-collection/contracts/mbta-api.md` の予算表を先に更新する
- 429（レート制限）を受けたらリトライせず、その回の処理を終える
- 理由: API キーなしの上限は送信元 IP 単位で 20 req/分。閲覧者の数に関係なく API の使用量を一定に保つため

### II. 書き込むのはジョブだけ。Web は読み取り専用

- DB への書き込みはバッチジョブだけが行う。Web アプリ（画面と内部 API）は読み取り専用
- 内部 API はすべて GET。クエリパラメータは検証し、不正な値には 400 を返す

### III. 外部からの入力は必ず検証する

- TypeScript は `strict`。`any` は使わない。外部入力（MBTA API の応答、クエリパラメータ、環境変数）は `unknown` として受け、zod でパースする
- MBTA API の応答でスキーマに合わない行は、スキップしてログに残す。ジョブ全体は落とさない
- MBTA API の列挙値（alerts の `effect` など）は固定の列挙型にせず、未知の値もそのまま保存する

### IV. ドメインロジックは純粋関数にしてテストする

- 到着検出・運行間隔・予測誤差などの計算は、副作用のない純粋関数として `src/lib/metrics/` に置く。しきい値などの定数は `src/lib/metrics/constants.ts` に集める
- 分析ロジックには必ず単体テスト（Vitest）を付ける。日付またぎ、Green Line 幹線の合算、取りこぼしの補間などの境界ケースを含める
- 主要な画面には E2E テスト（Playwright）を付ける。テストでは MBTA API を実際に呼ばず、実 API から記録したフィクスチャを使う

### V. 時刻の扱いを一か所にまとめる

- DB とサーバーでは時刻を UTC（`timestamptz` / `Date`）で扱う。表示するときだけ `America/New_York` に変換する
- MBTA の日時はオフセット付き文字列なので、必ずオフセットを考慮してパースする
- 運行日（service date）の計算は `src/lib/time.ts` だけで行う

### VI. 1 つのイメージを、環境に依存させずに昇格させる

- Web とすべてのジョブは同じコンテナイメージを使い、起動コマンドだけを変える
- イメージは CI で 1 回だけビルドし、同じダイジェストを dev → prod の順にデプロイする。再ビルドはしない
- 環境ごとの違いは、Terraform の変数と実行時の環境変数だけで表す。コードの中で環境名による分岐を書かない。ビルド時に埋め込まれる環境変数（`NEXT_PUBLIC_*` など）に環境ごとの値を入れない

### VII. マイグレーションは後方互換にする

- マイグレーションはデプロイの前に実行されるので、1 つ前のバージョンのコードでも動くように書く（expand → contract。列の削除やリネームは次のリリースで行う）
- これにより、ロールバックはイメージの差し替えだけで済む

## Additional Constraints

- **技術スタック**: Next.js（App Router, TypeScript）、Prisma ORM、PostgreSQL 16（Cloud SQL）、Cloud Run（サービス 1 つ + Jobs）、`us-east4`、MapLibre GL JS、Terraform、GitHub Actions。詳細と理由は各 feature の `plan.md` / `research.md` を参照
- **公開リポジトリ**: このリポジトリは public。秘密の値（パスワード、API キー、IAP の許可ユーザーのメールアドレスなど）をコミットしない。CI のログや artifact に秘密の値を出さない
- **出典表記**: 画面のフッターに `Data provided by MBTA` と地図タイルの帰属表示（OpenFreeMap / © OpenStreetMap contributors）を必ず出す
- **UI 言語**: 画面は英語。コード内のコメントとドキュメントは日本語でよい
- **コスト**: 最小構成を基本にする。常時起動のインスタンス（`min-instances > 0`）を使う場合は、plan の Complexity Tracking で理由を示す

## Development Workflow

- 機能の追加・変更は spec-kit の流れで進める: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`
- 仕様を変えるときは、先に該当する `specs/NNN-*/` の文書を更新してから実装する
- main への push 1 回につき、CI を 1 回、CD を 2 回（dev は自動、prod は承認後）実行する（`specs/004-infra-cicd/`）。PR では CI が走らないので、push の前にローカルで `pnpm lint && pnpm typecheck && pnpm test` を実行する
- コミットメッセージは英語の Conventional Commits（`feat:`, `fix:`, `chore:`, `docs:` …）

## Governance

- この constitution は他のすべての文書と慣習に優先する。plan の Constitution Check で各原則への適合を確認し、違反する場合は Complexity Tracking に理由を書く
- 原則の変更は、この文書を更新し、バージョンを上げ（原則の追加・削除は MAJOR、変更は MINOR、文言の修正は PATCH）、影響を受ける spec / plan を見直してから行う
- 日々の開発で参照するガイドは `CLAUDE.md`

**Version**: 1.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
