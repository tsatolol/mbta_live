---
description: "004 インフラと CI/CD の実装タスク"
---

# タスク: インフラと CI/CD（Infrastructure & CI/CD）

**入力**: `/specs/004-infra-cicd/` の設計文書（spec.md、plan.md、research.md、contracts/pipeline.md、quickstart.md）と `.specify/memory/constitution.md`、`docs/architecture.md`

**前提**: plan.md（必須）、spec.md（ユーザーストーリー）、contracts/pipeline.md

**テスト**: spec.md のテスト要件（TR-001〜TR-008）に基づいてタスクを含める。インフラとパイプラインは、自動テスト（CI で毎回動くもの）と、実装後に一度ずつ実際に試して確かめる手動の確認（「確認」と書いたタスク）に分かれる。

**構成**: ユーザーストーリーごとに分ける。`（人が行う）` と書いたタスクは、GCP や GitHub の画面での操作など、Claude Code では実行できないもの。

**002 との関係**: 実装の順番は 004 → 002 なので、004 の時点では 002 の画面と内部 API がない。`/api/health` だけは Cloud Run のヘルスチェックと監視に必要なので 004 で先に作り（T013）、主要 API のスモークテストと dev の E2E は「002 の完了後」のタスク（T048〜T049）に分ける。

## 書式: `[ID] [P?] [Story] 説明`

- **[P]**: 並行して進められる（別のファイルで、未完了のタスクに依存しない）
- **[Story]**: 対応するユーザーストーリー（US1〜US6）

---

## フェーズ 1: セットアップ（共通の土台）

**目的**: Terraform とワークフローのディレクトリ、人が行う事前準備

- [ ] T001 Terraform のディレクトリを作る: `infra/terraform/{bootstrap,modules/app,envs/dev,envs/prod}/`。各ディレクトリに `versions.tf`（Terraform と Google provider の最新安定版を `required_version` / `required_providers` で固定）を置く。`.terraform/`、`*.tfstate*`、`*.tfvars`（`terraform.tfvars.example` と `envs/*/terraform.tfvars` は除く）を `.gitignore` に追加する
- [ ] T002 [P] Terraform の書式と静的検査のコマンドを用意する: `pnpm infra:fmt`（`terraform fmt -recursive -check infra/terraform`）と `pnpm infra:validate`（各ディレクトリで `terraform init -backend=false && terraform validate`）: `package.json`、`scripts/infra-validate.sh`
- [ ] T003 （人が行う）GCP プロジェクトを 2 つ（dev / prod）作り、請求先アカウントをひも付ける。プロジェクト ID を `docs/architecture.md` の「環境の違い」と CLAUDE.md の未決事項に反映する
- [ ] T004 （人が行う）MBTA API キーを 2 つ（dev 用 / prod 用）取得する（https://api-v3.mbta.com で登録）
- [ ] T005 （人が行う）GitHub に Environment `dev` と `prod` を作る。`prod` に Required reviewers（オーナー）を設定し、両方とも Deployment branches を `main` だけにする。secret scanning と Dependabot alerts を有効にする

---

## フェーズ 2: 基盤（すべてのストーリーの前提）

**目的**: イメージ、bootstrap、アプリ一式のモジュール、両環境の定義

**⚠️ 重要**: このフェーズが終わるまで、CD のユーザーストーリー（US2〜US6）は始められない。US1（PR チェック）はこのフェーズに依存しない

### コンテナイメージ

- [ ] T006 Dockerfile を作る: マルチステージで `pnpm install --frozen-lockfile` → `prisma generate` → `next build`（standalone）。実行イメージには Next.js の standalone 出力、`src/jobs/` の各ジョブ（`tsx --conditions=react-server` で起動できる形、または esbuild でバンドルしたもの）、Prisma CLI と `prisma/` ディレクトリ（migrate Job 用）を入れる。非 root ユーザーで動かす。ビルド時に環境ごとの値を入れない（`NEXT_PUBLIC_*` を使わない）: `Dockerfile`、`.dockerignore`
- [ ] T007 イメージの起動コマンドを決める: web は `node server.js`、ジョブは `pnpm job:collect` などと同じ処理を呼ぶ `node` の起動コマンド、migrate は `prisma migrate deploy`。Cloud Run Job で上書きするコマンドを docs/architecture.md に記録する

### bootstrap（最初に一度だけ人が apply する）

- [ ] T008 bootstrap の Terraform を書く: 両プロジェクトの API の有効化（Cloud Run、Cloud SQL Admin、Secret Manager、Artifact Registry、Cloud Scheduler、IAP、IAM Credentials、Monitoring、Logging）、Terraform state の GCS バケット（環境ごと、バージョニング有効）、prod プロジェクトの Artifact Registry `mbta-live`（`us-east4`）: `infra/terraform/bootstrap/main.tf`、`variables.tf`、`outputs.tf`
- [ ] T009 bootstrap に WIF とサービスアカウントを追加する: 各プロジェクトの WIF pool / provider（attribute condition: `assertion.repository == "tsatolol/mbta_live" && assertion.ref == "refs/heads/main"`。PR 用の provider は作らない）、SA `ci-builder`（prod。Artifact Registry への書き込みだけ）、`deployer-dev` / `deployer-prod`（`roles/iam.workloadIdentityUser` の付与は OIDC トークンの `environment` クレームで `dev` / `prod` に限定）、`smoke-tester`（環境ごと）。deployer に `smoke-tester` の ID トークンを発行する権限（`roles/iam.serviceAccountOpenIdTokenCreator`）を付ける。dev プロジェクトの Cloud Run サービスエージェントに、prod の Artifact Registry の reader を付ける: `infra/terraform/bootstrap/iam.tf`、`wif.tf`
- [ ] T010 （人が行う）bootstrap を apply し、出力（WIF provider、各 SA のメールアドレス、Artifact Registry のパス）を GitHub の Environment / リポジトリの variables に登録する（`contracts/pipeline.md` の「GitHub の設定」）

### アプリ一式のモジュール

- [ ] T011 `modules/app` に Cloud SQL を書く: PostgreSQL 16、`db-f1-micro`、`us-east4`、バックアップ日数と `deletion_protection` は変数。DB とユーザー、パスワードは `random_password` で作って Secret Manager に入れる（state にも残るので、state のバケットへのアクセスは deployer と人だけにする）: `infra/terraform/modules/app/sql.tf`
- [ ] T012 `modules/app` に Secret Manager を書く: DB パスワードと `MBTA_API_KEY` のシークレット（`MBTA_API_KEY` は入れ物だけ作り、値は人が入れる）。実行用 SA に読み取り権限を付ける: `infra/terraform/modules/app/secrets.tf`
- [ ] T013 `/api/health` を作る（002 の `contracts/live-api.md` の定義どおり）: DB に接続できるか、`collector_runs` の最後の成功時刻、前日分の `aggregate_runs` があるかを返す。DB に接続できなければ 503。Route Handler と、本物の PostgreSQL を使う結合テスト: `src/app/api/health/route.ts`、`src/lib/db/health.ts`、`tests/integration/health.test.ts`
- [ ] T014 `modules/app` に Cloud Run サービス（web）を書く: `min-instances=0`、Cloud SQL の接続（Unix ソケット）、環境変数（`APP_ENV`、`INSTANCE_CONNECTION_NAME`、`DB_NAME`、`DB_USER`、Secret Manager からの `DB_PASSWORD`）、ヘルスチェックに `/api/health`、`lifecycle { ignore_changes = [image] }`、実行用 SA。IAP を有効にする（Cloud Run に直接組み込む方式。使えなければ外部 HTTPS LB + Serverless NEG + IAP。方式を検証して research.md に記録する）。IAP で許可するユーザーは変数 `iap_members` と `smoke-tester`: `infra/terraform/modules/app/web.tf`、`iap.tf`
- [ ] T015 `modules/app` に Cloud Run Jobs を書く: `collector`（タスクのタイムアウト 50 秒、リトライ 0）、`sync-static`、`aggregate`（環境変数 `RAW_RETENTION_DAYS`）、`migrate`。collector と sync-static には Secret Manager の `MBTA_API_KEY` を渡す。`lifecycle { ignore_changes = [image] }`: `infra/terraform/modules/app/jobs.tf`
- [ ] T016 `modules/app` に Cloud Scheduler を書く: collector（間隔は変数。dev `*/5 * * * *` / prod `* * * * *`）、sync-static（毎日 04:00）、aggregate（毎日 04:30）。タイムゾーンは `America/New_York`。起動用 SA に Job の実行権限だけを付ける: `infra/terraform/modules/app/scheduler.tf`
- [ ] T017 `envs/dev` と `envs/prod` を書く: GCS の backend、`module "app"` の呼び出し、`terraform.tfvars`（公開してよい値だけ: プロジェクト ID、collector の間隔、`RAW_RETENTION_DAYS`、バックアップ日数、`deletion_protection`、予算額）。`iap_members` などは GitHub Environment の secret（`TF_VAR_iap_members`）で渡す: `infra/terraform/envs/{dev,prod}/{backend.tf,main.tf,terraform.tfvars}`
- [ ] T018 `pnpm infra:fmt` と `pnpm infra:validate` が通ることを確かめる（TR-001 の前半）

**チェックポイント**: イメージと Terraform がそろった。ここから各ユーザーストーリーに入れる

---

## フェーズ 3: ユーザーストーリー 1 - PR の段階で壊れたコードに気づく（優先度: P1）🎯 MVP

**目標**: main 向けの PR で軽いチェックが動き、合格しないとマージできない

**単独での確認方法**: 型エラーを含む PR を開き、チェックが失敗してマージできないことを確かめる

### ユーザーストーリー 1 の実装

- [ ] T019 [US1] PR チェックのワークフローを書く: トリガーは `pull_request`（main 向け。`pull_request_target` は使わない）、権限は `contents: read` だけ。`pnpm install --frozen-lockfile` → lint → typecheck → `pnpm test:unit` → Gitleaks（PR の差分）→ `actions/dependency-review-action`（high 以上で失敗）。5 分以内を目安にする: `.github/workflows/pr-checks.yml`
- [ ] T020 [P] [US1] Gitleaks の設定を書く: `tests/fixtures/` の MBTA API の応答（公開データ）を誤検知しないよう許可リストに入れる: `.gitleaks.toml`
- [ ] T021 [US1] （人が行う）main にブランチ保護を設定する: PR 経由のマージだけを許可、`pr-checks` の合格を必須、承認者の人数は 0、force push と削除を禁止
- [ ] T022 [US1] 確認（TR-008）: 型エラー、秘密の値に見える文字列、既知の脆弱性を持つ依存をそれぞれ含む PR を一度ずつ作り、チェックが失敗してマージできないことを確かめる。確かめたら PR は閉じる

**チェックポイント**: US1 が動く。以降の変更は PR 経由になる

---

## フェーズ 4: ユーザーストーリー 2 - マージすると dev に自動で出て、実環境で確かめられる（優先度: P1）

**目標**: main の更新で、リリース用の CI が 1 回動き、承認なしで dev にデプロイされ、スモークテストが通る

**単独での確認方法**: 小さな変更をマージし、CI → dev へのデプロイ → スモークテストが成功することを確かめる

### ユーザーストーリー 2 のテスト

- [ ] T023 [P] [US2] スモークテストを書く（TR-002）: `smoke-tester` の ID トークンで IAP を通し、`/api/health` が 200 で DB に接続できていること、認証なしのリクエストが拒否される（401 / 403 / ログイン画面へのリダイレクト）ことを確かめる。対象の URL とトークンは環境変数で受け取る。主要 API の確認は 002 の完了後に足す（T048）: `tests/smoke/smoke.test.ts`、`vitest.config.ts`（`smoke` プロジェクトを追加。`pnpm test` には含めない）、`package.json`（`pnpm test:smoke`）
- [ ] T024 [P] [US2] コンテナの起動確認のスクリプトを書く（TR-006）: ビルドしたイメージをテスト用の PostgreSQL に向けて起動し、`/api/health` が 200 を返すこと、migrate と collector（`MBTA_FIXTURE_MODE=1`）の起動コマンドが成功することを確かめる: `scripts/check-container.sh`
- [ ] T025 [P] [US2] マイグレーションの互換性テストのスクリプトを書く（TR-003）: prod で最後に成功したデプロイのコミット（GitHub の Environment `prod` のデプロイ履歴）を取り、そのコミットを `git worktree` で取り出す。新しいマイグレーションを適用したテスト用 DB に対して、そのコミットの `pnpm test:integration` を実行する。prod へのデプロイがまだなければ飛ばす（方式を検証して research.md に記録する）: `scripts/check-migration-compat.sh`

### ユーザーストーリー 2 の実装

- [ ] T026 [US2] リリース用パイプラインの `ci` ジョブを書く: トリガーは main への push、`concurrency: pipeline-main`。`pnpm install` → lint → typecheck → unit / integration / replay（PostgreSQL 16 のサービスコンテナ）→ T025 → `pnpm audit --audit-level high` → Gitleaks（リポジトリ全体）→ `docker build` → T024 → ci-builder として WIF で認証し Artifact Registry に push（タグ = git SHA）→ outputs `image_digest`: `.github/workflows/pipeline.yml`
- [ ] T027 [US2] `ci` ジョブに Terraform の検査と plan を加える（TR-001）: `terraform fmt -check` / `validate`、dev と prod の `terraform plan`（それぞれの deployer の権限で読み取りだけ。plan ファイルは artifact にしない）、prod の plan の `resource_changes` のハッシュを outputs `prod_plan_hash` に出す（方式を検証して research.md に記録する）: `.github/workflows/pipeline.yml`、`scripts/plan-hash.sh`
- [ ] T028 [US2] `ci` ジョブに承認用のサマリーを加える（FR-021）: prod で動いているコミットから今回までのコミット一覧、追加されるマイグレーションのファイル名、dev / prod の plan の要約（変更・追加・削除の件数と対象のリソース。秘密の値は出さない）、テストとセキュリティ検査の結果を `$GITHUB_STEP_SUMMARY` に書く: `scripts/approval-summary.sh`
- [ ] T029 [US2] `cd-dev` ジョブを書く: `environment: dev`、`needs: ci`、`concurrency: deploy-dev`。deployer-dev として WIF で認証 → `terraform apply`（envs/dev）→ migrate Job をそのイメージ（ダイジェスト指定）で実行 → web をデプロイ（トラフィック 100%）→ collector / sync-static / aggregate の Job のイメージを更新 → T023 のスモークテスト → collector Job を 1 回実行（`--wait`）: `.github/workflows/pipeline.yml`
- [ ] T030 [US2] 確認: 小さな変更を PR → マージし、CI が 1 回だけ動いて dev にデプロイされ、スモークテストが成功することを確かめる。テストを 1 つ失敗させた PR では、dev にも prod にもデプロイされないことを確かめる（SC-002 の所要時間も記録する）

**チェックポイント**: US1 と US2 が動く。dev で収集が始まる

---

## フェーズ 5: ユーザーストーリー 3 - 承認すると同じものが安全に prod に出る（優先度: P1）

**目標**: オーナーの承認後に、dev と同じイメージがトラフィック 0% で確認されてから prod に出る

**単独での確認方法**: 承認して prod に出る流れと、安全装置（古い run、plan のハッシュ、タグ付き URL のスモークテストの失敗）が働くことを確かめる

### ユーザーストーリー 3 の実装

- [ ] T031 [US3] `cd-prod` ジョブの前半を書く: `environment: prod`（Required reviewers）、`needs: cd-dev`、`concurrency: deploy-prod`。`github.sha` が main の HEAD でなければ失敗 → deployer-prod として WIF で認証 → `terraform plan`（envs/prod）のハッシュが `prod_plan_hash` と違えば失敗 → `terraform apply`: `.github/workflows/pipeline.yml`
- [ ] T032 [US3] `cd-prod` にマイグレーション前のバックアップを加える（FR-019）: 新しいマイグレーションがあるときだけ `gcloud sql backups create` を実行し、完了を待ってから migrate Job を動かす: `.github/workflows/pipeline.yml`
- [ ] T033 [US3] `cd-prod` に段階的な切り替えを加える（FR-018）: web の新しいリビジョンを `--no-traffic --tag candidate` でデプロイ → タグ付き URL に対してスモークテスト（失敗したら切り替えずに終了）→ トラフィックを 100% に切り替え → 本番 URL に対してスモークテスト（失敗したら直前のリビジョンに戻して失敗）→ 各 Job のイメージを更新 → collector Job を 1 回実行（`--wait`）。タグ付き URL を IAP を通して ID トークンで呼べるかを検証して research.md に記録する: `.github/workflows/pipeline.yml`
- [ ] T034 [US3] 確認（TR-004）: (1) 承認待ちの古い run を承認すると失敗する、(2) 承認後に prod の Terraform を手で変えると plan のハッシュが合わずに失敗する、(3) スモークテストが失敗するリビジョン（`/api/health` が 503 を返すようにした一時的な変更）でトラフィックが切り替わらない、をそれぞれ一度ずつ試して確かめる（SC-003 の所要時間も記録する）

**チェックポイント**: US1〜US3 が動く。prod で収集が始まる

---

## フェーズ 6: ユーザーストーリー 4 - 問題が起きたら前のバージョンに戻す（優先度: P2）

**目標**: 指定したイメージ、または直前のリビジョンにすぐ戻せる

**単独での確認方法**: dev でロールバックを実行し、web とジョブが戻ることを確かめる

- [ ] T035 [US4] ロールバックのワークフローを書く: `workflow_dispatch`（入力 `environment`、任意の `image_digest`）、`environment:` に入力値を指定（prod では承認が必要）。`image_digest` がなければ web のトラフィックを直前のリビジョンに戻すだけ、あれば web と各 Job をそのイメージに差し替える。Terraform の apply とマイグレーションは実行しない。終わったらスモークテスト: `.github/workflows/rollback.yml`
- [ ] T036 [US4] 確認: dev で両方の使い方を一度ずつ試し、SC-004（5 分以内）を確かめる

---

## フェーズ 7: ユーザーストーリー 5 - 環境が分かれていて、許可した人だけが見られる（優先度: P2）

**目標**: dev の権限で prod を操作できず、許可されていないユーザーは画面と API にアクセスできない

**単独での確認方法**: 権限とアクセスの拒否を実際に試して確かめる

- [ ] T037 [US5] `modules/app` に予算アラートを書く（FR-012）: 環境ごとの予算額（tfvars）を超えそうなときにメールで通知する: `infra/terraform/modules/app/budget.tf`
- [ ] T038 [US5] 確認: (1) deployer-dev の権限で prod のリソースを操作できない、(2) `environment: dev` のジョブから deployer-prod を使えない、(3) main 以外のブランチやフォークの PR から WIF で認証できない、(4) 許可されていない Google アカウントと認証なしのリクエストは画面・API にアクセスできない、をそれぞれ試して確かめる

---

## フェーズ 8: ユーザーストーリー 6 - 本番の異常に気づける（優先度: P2）

**目標**: データ品質と web の異常がメールで通知される（prod だけ）

**単独での確認方法**: dev で各条件を起こし、ダッシュボードに出ることと、prod と同じ設定で通知されることを確かめる

- [ ] T039 [US6] 構造化ログの項目を、ログベースの指標で使える形にそろえる: collector / sync-static / aggregate の終了ログに `job`・`status`・件数（`vehicles`、`rejectedRows`、`unknownStopIds` など）が必ず入ることを結合テストで確かめる: `src/jobs/runner.ts`、`tests/integration/runner.test.ts`
- [ ] T040 [US6] `modules/app` に監視を書く（FR-013）: ログベースの指標（収集の成否、解析に失敗した行の割合、運行時間中の車両数、未解決の駅 ID の数）と、アラートポリシー（最後の収集成功から 3 分以上、05:30〜24:00 ET の車両 0 件、解析失敗の割合 1% 超、未解決の駅 ID の増加、05:00 ET 時点で前日分の集計が未完了）。通知先はメール（アドレスは `TF_VAR_alert_email`）。dev では通知せずダッシュボードだけ: `infra/terraform/modules/app/monitoring.tf`
- [ ] T041 [US6] `modules/app` に web の監視を書く（FR-020）: Cloud Run の指標で 5xx の割合（5 分間で 5% 超）と応答時間（p95 が 3 秒超）のアラートポリシー。`/api/health` の稼働時間チェック（`smoke-tester` の ID トークンで IAP を通す。方式を検証して research.md に記録する）: `infra/terraform/modules/app/monitoring.tf`
- [ ] T042 [US6] 確認（TR-005）: dev で各条件を起こし（collector の Scheduler を止める、`/api/health` を 503 にするなど）、prod と同じ設定にした通知先へ通知が届くことを一度ずつ確かめる

---

## フェーズ 9: 仕上げと横断的な作業

**目的**: 文書の反映、002 の完了後に有効にするもの、全体の確認

- [ ] T043 [P] docs/architecture.md を更新する: 実際のプロジェクト ID、イメージの起動コマンド、IAP の方式、監視の構成（flow-back）
- [ ] T044 [P] docs/development.md に、インフラのコマンド（`pnpm infra:fmt` / `pnpm infra:validate` / `pnpm test:smoke`）と、パイプラインの流れへのリンクを追記する
- [ ] T045 quickstart.md の手順を最初から実行し、書かれている結果になることを確かめる。違っていれば quickstart.md を直す
- [ ] T046 CLAUDE.md の未決事項（GCP プロジェクト ID、承認者、MBTA API キーの取得）を更新する
- [ ] T047 `/speckit-analyze` で 004 の文書とタスクの食い違いを点検し、見つかったものを反映する

### 002 の完了後に有効にするもの

- [ ] T048 スモークテストに主要な内部 API の確認を加える: `/api/live/vehicles`、`/api/static/routes`、`/api/live/alerts` が 200 を返し、応答が `src/lib/api-schemas/` の共有の zod スキーマで解析できる（TR-002 の残り）: `tests/smoke/smoke.test.ts`
- [ ] T049 dev での E2E を有効にする（TR-007）: 読み取りだけの短い Playwright のテスト（地図に路線と車両が出る、駅の到着表示が出る、アラートの一覧が出る、地図タイルが読み込まれる）を dev の URL に対して、IAP を通して実行する。`cd-dev` ジョブの最後に加える: `tests/e2e/dev/`、`.github/workflows/pipeline.yml`

---

## 依存関係と実行順

### フェーズの依存関係

- **セットアップ（フェーズ 1）**: 依存なし。T003〜T005（人が行う）は早めに始める
- **基盤（フェーズ 2）**: セットアップの完了が前提。T010 は T008〜T009 と T003 が前提
- **US1（フェーズ 3）**: 基盤に依存しない。セットアップの T001〜T002 の後すぐ始められる（GCP がなくてもよい）
- **US2（フェーズ 4）**: 基盤の完了と T010（bootstrap の apply と variables の登録）が前提
- **US3（フェーズ 5）**: US2 の完了が前提（同じ `pipeline.yml` の後段）
- **US4〜US6**: US2 の完了が前提。互いには独立
- **仕上げ（フェーズ 9）**: US1〜US6 の完了が前提。T048〜T049 は 002 の完了が前提

### ユーザーストーリーの依存関係

- **US1（P1）**: 他に依存しない。最初に入れると、以降の変更がすべて PR のチェックを通る
- **US2（P1）**: 基盤（イメージ、bootstrap、モジュール、envs）が前提
- **US3（P1）**: US2 の `ci` / `cd-dev` ジョブが前提
- **US4（P2）**: US2 が前提（dev にデプロイ済みのリビジョンが要る）
- **US5（P2）**: US2 が前提（T037 の予算アラートは基盤の後ならいつでもよい）
- **US6（P2）**: US2 が前提。T039 は基盤の前でも始められる

### 同じファイルを触るタスク（並行しない）

- `.github/workflows/pipeline.yml`: T026 → T027 → T028 → T029 → T031 → T032 → T033 → T049
- `infra/terraform/modules/app/monitoring.tf`: T040 → T041
- `tests/smoke/smoke.test.ts`: T023 → T048

### 並行して進められるもの

- セットアップの T002 と、人が行う T003〜T005
- 基盤の T006〜T007（イメージ）、T008〜T009（bootstrap）、T011〜T016（モジュール。ファイルが分かれている）、T013（`/api/health`）
- US2 のテスト（T023〜T025）
- US2 の完了後、US4・US5・US6 は並行して進められる

---

## 並行実行の例: 基盤

```bash
タスク: "Dockerfile（T006）"
タスク: "bootstrap の Terraform（T008〜T009）"
タスク: "modules/app の Cloud SQL・Secret Manager・Jobs・Scheduler（T011、T012、T015、T016）"
タスク: "/api/health と結合テスト（T013）"
```

## 並行実行の例: ユーザーストーリー 2 のテスト

```bash
タスク: "スモークテスト（tests/smoke/smoke.test.ts）"
タスク: "コンテナの起動確認（scripts/check-container.sh）"
タスク: "マイグレーションの互換性テスト（scripts/check-migration-compat.sh）"
```

---

## 実装の進め方

### MVP（ユーザーストーリー 1 のみ）

1. T001〜T002 と T019〜T021 で PR チェックとブランチ保護を入れる（GCP がなくても入れられる）
2. **止めて確かめる**: T022
3. 以降の 004 の変更は、すべて PR のチェックを通して入れる

### 段階的な追加

1. 人が行う準備（T003〜T005）と基盤（フェーズ 2）→ bootstrap の apply（T010）
2. US2 → dev で収集が始まる
3. US3 → prod で収集が始まる（**001 の目的「分析用のデータをできるだけ早く貯め始める」はここで達成**）。prod の稼働前に MBTA API キー（T004）を Secret Manager に入れておく
4. US6（監視）→ US4（ロールバック）→ US5（権限と予算の確認）
5. 002 の完了後に T048〜T049

### `/speckit-implement` の範囲の区切り方

コンテキストがあふれないよう、1 回の実行はフェーズ単位にする。`（人が行う）` のタスクと「確認」のタスクは、Claude Code が手順を案内し、人が実行して結果を伝える。

---

## 注意

- [P] は別のファイルで、未完了のタスクに依存しないもの
- [Story] はユーザーストーリーとの対応を示す
- 秘密の値（パスワード、API キー、IAP で許可するメールアドレス、通知先のメールアドレス）はコミットしない。tfvars には公開してよい値だけを書く
- Terraform の apply はパイプラインが行う。bootstrap だけは人が一度だけ apply する
- 「方式を検証して research.md に記録する」と書いたタスクは、実装時に試した結果（採った方式と、採らなかった方式とその理由）を research.md に残す（flow-back）
