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

### IV. 壊れやすい所に厚くテストする

このアプリのバグは、外部 API の想定外の値、時間の扱い、データの変換・集計で起きやすい。テストはここに厚くかけ、画面の見た目には薄くかける。

- **純粋関数**: 到着検出・サンプリング・運行日・指標の計算は `src/lib/metrics/`・`src/lib/time.ts` の純粋関数にし、入力と期待値の表で単体テストする。不変条件（便と駅の組で到着は 1 件、運行間隔は負にならない など）はプロパティベーステスト（fast-check）でも確かめる。しきい値は `src/lib/metrics/constants.ts` に集める
- **API 応答の解析**: 実 API から記録したフィクスチャで zod スキーマと変換を確かめる。実測で見つかった特殊なケース（終点駅の番線 ID、更新の止まった車両、予告アラート、運休便など）は、それぞれ専用のフィクスチャにする
- **本物の DB**: DB を使うテストは本物の PostgreSQL 16 で行う。インメモリの代替や SQLite は使わない。集計 SQL は、同じ指標の TypeScript 版と小さなデータで結果を突き合わせる
- **再生テスト**: 実 API の連続ポーリングの記録を、時計を固定して collector に順に流し、DB の最終状態を確かめる。同じ回を 2 回流しても結果が変わらないこと（冪等性）も確かめる
- **時計の注入**: 現在時刻は `src/lib/clock.ts` から取り、テストで固定できるようにする。夏時間の切り替え日（11 月第 1 日曜、3 月第 2 日曜）と運行日の日付またぎは必ずテストケースに入れる
- **マイグレーション**: 新しいスキーマに対して 1 つ前のリリースのコードが動くこと（原則 VII）を CI で確かめる
- **画面**: E2E（Playwright）は主要な流れと状態（運行時間外、データが古い、運休など）に絞る。グラフは画像で比べず、グラフに渡すデータへの変換を単体テストする
- **やらないこと**: テスト（CI を含む）で実 API を呼ばない。読まれない巨大なスナップショットを期待値にしない
- **本番の監視もテストの一部**: テストで捕まえられない現実の変化（応答の形の変化、データの欠落）は、本番のデータ品質の監視で捕まえる（`specs/004-infra-cicd/`）

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
- 日々の開発で参照するガイドは `CLAUDE.md`、システム全体の現在の構成は `docs/architecture.md`

### 文書の保守方針（Spec Persistence: flow-back）

- 実装中や運用中に分かったこと（API の実測結果、方針の変更など）は、どの文書からでも反映してよい。反映したら `/speckit-analyze` で文書間の食い違いを点検する
- feature をまたぐ情報（システム構成、リポジトリ構成、環境の違い、環境変数）は `docs/` にだけ書き、各 feature からは参照する。同じ情報を複数の文書に書かない
- DB スキーマの正は、実装前は各 feature の `data-model.md`、実装後は `prisma/schema.prisma`。`data-model.md` は「その feature で何を足したか・なぜか」の記録として残す
- 中身の薄い任意の文書（`data-model.md`, `contracts/`, `research.md`, `quickstart.md`）は作らない。`spec.md` と `plan.md` は必須
- テストは `spec.md` の要件（Testing Requirements）として明記する。`/speckit-tasks` は spec で求められたテストしかタスクにしないため

**Version**: 1.1.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-02
