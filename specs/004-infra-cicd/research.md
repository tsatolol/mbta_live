# 調査と決定: インフラと CI/CD

## GCP のプロジェクト構成: dev / prod の 2 プロジェクト

- **決定**: dev と prod で別プロジェクト。イメージは prod プロジェクトの Artifact Registry に 1 つだけ置き、dev の Cloud Run サービスエージェントに読み取り権限を付ける
- **理由**: IAM・課金・クォータを分離でき、dev の操作ミスが prod に及ばない。同じイメージを昇格させるにはレジストリが 1 つのほうが簡単
- **検討した代替案**: 共通 + dev + prod の 3 プロジェクト（分離はきれいだが管理対象が増える）、1 プロジェクト内で名前で分ける（IAM の分離が弱い）

## パイプラインの形: PR で軽いチェック、マージで 1 本、承認ゲート

- **決定**: PR では軽いチェック（lint・型・単体テスト・秘密の値・依存関係）を行い、合格をマージの条件にする。main はブランチ保護で PR 経由の更新だけにする。マージ（= main への push）でリリース用のパイプライン CI → CD dev（自動）→ CD prod（GitHub Environments の Required reviewers で承認後）を 1 本で動かす
- **理由**: 壊れたコードを main に入れる前に止められる。リリース用の CI は main の更新 1 回につき 1 回のままなので、「CI 1 回・CD 2 回」はリリース単位で保たれる。リポジトリが public なので承認機能とブランチ保護を無料で使える
- **検討した代替案**: PR では何も動かさない（当初案。壊れたコードに気づくのが main に入った後になるため変更）、PR で CI と dev へのデプロイ、マージで prod（レビュー = PR のコードレビューになる案。ユーザーの判断で不採用）
- **トレードオフ**: 1 つの変更で、PR の軽いチェックとリリース用の CI の 2 回テストが動く。PR 側は 5 分以内に収まる軽いものだけにする

## 古い run の承認を防ぐ

- **決定**: cd-prod は `github.sha` が main の HEAD でなければ失敗させる
- **理由**: 承認待ちの古い run を承認すると、古いイメージで prod を上書きしてしまうため

## 承認時と適用時のインフラ変更の一致

- **決定**: CI で prod の plan の `resource_changes` のハッシュを出し、cd-prod で plan し直したときのハッシュと比べる
- **理由**: 承認者が見た変更内容と違うものが prod に適用されるのを防ぐ。plan ファイル自体は秘密の値を含みうるので、public リポジトリの artifact には置けない
- **未解決**: ハッシュの作り方（unknown な値の扱いなど）は実装時に検証する

## Terraform の構成

- **決定**: `bootstrap/`（最初に一度だけ手動で apply）、`modules/app/`（アプリ一式）、`envs/{dev,prod}/`（同じモジュールを呼び、変数だけ変える）。state は各環境のプロジェクトの GCS バケット
- **理由**: state バケットや WIF などパイプラインの前提になるものは、パイプラインでは作れない。環境の差を変数に閉じ込める

## 認証: Workload Identity Federation

- **決定**: サービスアカウントのキーは使わない。WIF の attribute condition で `repository == tsatolol/mbta_live` かつ `ref == refs/heads/main` に限定し、deployer SA の利用は OIDC トークンの `environment` クレームで絞る（deployer-prod は `environment == prod` のジョブだけ）
- **理由**: キーの漏えいリスクがない。public リポジトリでも、main 以外やフォークからは使えない

## IAP

- **決定**: Cloud Run に直接組み込む方式（`--iap`）。使えない場合は外部 HTTPS LB + Serverless NEG + IAP
- **理由**: ロードバランサが不要でコストが小さい

## マイグレーション

- **決定**: デプロイの前に migrate Job（`prisma migrate deploy`）を実行する。マイグレーションは expand → contract で書く
- **理由**: 1 つ前のイメージでも動くので、ロールバックはイメージの差し替えだけで済む。dev が先に通るので、壊れたマイグレーションは dev で止まる

## デプロイ後のテスト

- **決定**: dev と prod の両方で、IAP を通したスモークテスト（`/api/health`、主要な API、認証なしの拒否、collector の実行）を行う。dev では読み取りだけの短い E2E も実行する
- **理由**: CI のテストはテスト用 DB とフィクスチャで動くので、IAP、Secret Manager、Cloud SQL への接続、地図タイルの読み込みなど、実環境でしか確かめられないものがある

## prod へのリリース方式: トラフィック 0% で確認してから切り替え

- **決定**: prod の web は新しいリビジョンをトラフィック 0%・タグ付きでデプロイし、タグ付き URL でスモークテストしてから 100% に切り替える。切り替え後のスモークテストが失敗したら直前のリビジョンに戻す
- **理由**: 手間が小さく、壊れたリビジョンを利用者に見せずに済む
- **検討した代替案**: Canary（10% ずつの移行。利用者が少数なので効果が小さい）、直接 100%（当初案）

## prod のマイグレーション前のバックアップ

- **決定**: 新しいマイグレーションがあるときだけ、適用前に Cloud SQL のオンデマンドバックアップを取る
- **理由**: マイグレーションは後方互換で書くが、データを書き換える操作の誤りはリビジョンを戻しても直らない

## セキュリティ検査

- **決定**: PR では Gitleaks（差分）と dependency-review、リリース用の CI では `pnpm audit`（high 以上で失敗）と Gitleaks（全体）。GitHub の secret scanning と Dependabot alerts も有効にする
- **理由**: public リポジトリなので、秘密の値の混入と脆弱な依存は公開と同時に問題になる

## 対象外にしたもの

- 負荷テスト: 利用者が少数で、MBTA API への負荷は利用者数に関係なく一定。収集の所要時間は 001 の成功基準で見る
- ログイン・認可・テナント分離・課金のテスト: アプリにこれらの機能がない。認証は IAP だけなので、スモークテストで「認証なしは拒否される」ことだけを確かめる
- Cloud Deploy による承認: GitHub の承認機能で足りる

## dev のコスト

- **決定**: dev は collector 5 分間隔、生データ 3 日保持、Cloud SQL のバックアップ 1 日
- **理由**: dev の分析画面は表示の確認用と割り切り、数値の妥当性は prod で確認する

## ツールとバージョン（2026-11-02 時点）

- **決定**: Terraform 1.17（`~> 1.17`）、Google プロバイダ 8.9（`~> 8.9`）、random プロバイダ 3.9（`~> 3.9`）。それぞれ 2026-11-02 時点の最新安定版
- **ロックファイル**: `.terraform.lock.hcl` は、bootstrap と envs を最初に `terraform init` するとき（T010、T017）に、Linux と macOS の両方のハッシュを入れて（`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`）コミットする。`pnpm infra:validate` は一時ディレクトリのコピーで実行するので、ロックファイルをリポジトリに残さない
- **GitHub Actions**: `actions/checkout@v5`、`actions/setup-node@v5`、`pnpm/action-setup@v4`、`gitleaks/gitleaks-action@v2`、`actions/dependency-review-action@v4` をメジャーバージョンのタグで指定した。開発環境から GitHub のリリースを参照できず、最新版の確認とコミットの SHA での固定ができなかったため。Dependabot の version updates（`github-actions`）で更新を追うか、SHA で固定するかは T047 で見直す
- **Gitleaks**: 開発環境では Gitleaks を実行できなかった（GitHub のリリースから取得できないため）。PR チェックの実行と T022 の確認で動作を確かめた（`gitleaks-action@v2` が入れるのは Gitleaks 8.24.3）
  - 既定のルールは、汎用的な形の秘密の値（`api_key = "<16 進数 32 文字>"` など）を検出しなかった。特定のサービスの形式や秘密鍵のような、形の決まった値を検出する道具と考える。汎用的な値の混入は、`.env.local` をコミットしない運用（`.gitignore`）と、秘密の値を Secret Manager / GitHub の secrets にだけ置くルールで防ぐ
  - 秘密鍵のブロック（`-----BEGIN RSA PRIVATE KEY-----`）は、ルール `private-key` で検出された。ログでは値が伏せ字（REDACTED）になる

## T022 の確認結果（2026-11-02）

テスト用の PR を 3 つ作り、ブランチ保護（ルールセット）と `pr-checks` の動作を確かめた。確認後に PR は閉じた。

| PR | 内容 | `pr-checks` | マージ API |
|---|---|---|---|
| tsatolol/mbta_live#11 | 型エラー | 型チェックで失敗 | 「Required status check "pr-checks" is failing」で拒否 |
| tsatolol/mbta_live#12 | 秘密の値 | 汎用の `api_key`（16 進数）は検出されず成功。ダミーの秘密鍵のブロックを足すと Gitleaks が検出して失敗 | 同上で拒否 |
| tsatolol/mbta_live#13 | 既知の脆弱性を持つ依存（`lodash@4.17.20`） | 依存関係の検査が high の脆弱性（GHSA-35jh-r3h4-6jhm など）を検出して失敗 | 同上で拒否 |

- チェックの実行中にマージしようとしても「Required status check "pr-checks" is in progress」で拒否された
- `pr-checks` の所要時間は 30〜60 秒程度
- 初回の実行は、リポジトリの Dependency graph が無効だったため、依存関係の検査が「Dependency review is not supported on this repository」で失敗した。Dependency graph を有効にして解消した（quickstart.md の事前準備に含まれる）
- main への直接 push が拒否されることは、GitHub のルールセットの画面で確認する（Claude Code からは試さない）
- テスト用のブランチ（`test/t022-*`）は、開発環境のプロキシがブランチの削除を拒否したため、GitHub の画面で削除する

## main の依存の脆弱性（2026-11-02 に判明）

- `pnpm audit` で 5 件（high 1、moderate 4）。どれも間接的な依存: `prisma` → `@prisma/studio-core` → `@visx/responsive` → `lodash`（4.17.23 以下）、`eslint` → `minimatch`（11.0.1 未満）
- `prisma` CLI は migrate Job のために実行イメージに入るので、開発用の依存として無視はできない。リリース用の CI（T026）の `pnpm audit --audit-level high` でも失敗する
- 対応: `package.json` の `pnpm.overrides` で `lodash` を `>=4.18.0`（4.18.1 に）、`minimatch@<11.0.1` を `>=11.0.1`（11.0.4 に）上げた。`pnpm audit` が 0 件になり、lint・型チェック・全テスト（148 件）が通ることを確かめた。上流（Prisma Studio、ESLint）が修正版に追従したら、この overrides を外す

## bootstrap の範囲: GCP プロジェクトと GitHub の設定まで含める（2026-11-02）

- **決定**: bootstrap の Terraform で、GCP プロジェクト（dev / prod）の作成と請求先アカウントのひも付け、GitHub の Environment（Required reviewers、Deployment branches）・variables・secrets、main のルールセット、Dependency graph などのセキュリティ設定まで作る。人の手作業は次の 3 つだけにする
  1. 請求先アカウントの ID を確かめ、プロジェクト ID を決める
  2. MBTA API キーを取得し、Secret Manager に入れる（キーを発行する API がない。Terraform の変数で渡すと値が state に残る）
  3. ご自身の Google アカウントと GitHub のトークンで、bootstrap を一度だけ apply する
- **理由**: 手作業を減らし、設定をコードとして残せる。特に bootstrap の出力（WIF provider、SA のメールアドレス、Artifact Registry のパス）を GitHub の variables に手で写す作業がなくなり、写し間違いが起きない
- **考えたこと**
  - **state の鶏と卵**: bootstrap 自身の state は、bootstrap が作るバケットに最初からは置けない。初回はローカルの state で apply し、作ったバケットに `terraform init -migrate-state` で移す
  - **権限**: 個人アカウントなので組織（Organization）がなく、プロジェクトは「組織なし」で作られる。apply には、請求先アカウントのユーザー権限がある Google アカウントでの `gcloud auth application-default login` と、GitHub の fine-grained personal access token（このリポジトリだけ、Administration・Environments・Secrets・Variables の読み書き）が要る。トークンは apply が終わったら削除する
  - **削除の事故**: プロジェクトを Terraform で管理すると `terraform destroy` で消せてしまうので、`deletion_policy = "PREVENT"` と `prevent_destroy` を付ける
  - **secrets の値**: GitHub の Environment の secrets（IAP で許可するメールアドレス、通知先のメールアドレス）は bootstrap の sensitive な変数で渡すので、bootstrap の state に値が残る。state のバケットは公開アクセスを禁止し、読めるのは人と deployer に限る
  - **画面で作った設定**: T021 で画面から作った main のルールセットと、T022 の前に画面で有効にした Dependency graph などは、`import` ブロックで取り込む
  - **`WEB_URL`**: web の URL は envs の apply（Cloud Run）で決まり、bootstrap の時点では分からない。パイプラインは `gcloud run services describe` で取得するので、GitHub の variables には登録しない
- **検討した代替案**: GCP プロジェクトと GitHub の設定は画面で作る（当初案。手作業と写し間違いが多い）
- **未確認**: 開発環境からは Terraform のレジストリに接続できず、GitHub プロバイダの最新版と、ルールセットや `security_and_analysis` の書式を手元で `terraform validate` できない（Google プロバイダはローカルのミラーで検証できる）。T009 は GitHub プロバイダのドキュメントに沿って書き、T010 の apply の前の `terraform plan` で確かめる


## フェーズ 2 の実装で決めたこと（2026-11-03）

### イメージの中身

- **決定**: 実行イメージ（`node:24-bookworm-slim`、非 root の `node` ユーザー）に、次の 3 つを入れる
  - `/app/server.js` ほか: Next.js の standalone 出力（web）。node_modules は Next.js がたどった分だけ（約 63MB）
  - `/app/jobs/*.mjs`: 各ジョブを esbuild で依存ごと 1 ファイルにまとめたもの（各 約 6MB。`pnpm build:jobs`）。node_modules なしで動く。`server-only` は `react-server` の条件で空のモジュールとして取り込む
  - `/app/migrate/`: lockfile どおりに入れた本番用の依存から、Prisma CLI に要らない `next`・`@next/*`・`@img/*`（sharp）・`@prisma/client` を除いたもの（約 310MB）と、`prisma/`・`prisma.config.ts`
- **理由**: 本番用の依存をそのまま入れると 821MB になる（`next` と `@next/swc` の 2 種類で約 400MB）。web は standalone で足り、ジョブはまとめれば依存がいらない。Prisma CLI だけは依存が多く（Prisma Studio など）まとめられないので、lockfile どおりに入れてから大きなものを除いた
- `prisma` は migrate Job が実行時に使うので `dependencies` に移した。esbuild は `devDependencies` に明示した
- **検討した代替案**: ジョブを `tsx` で動かす（tsx と全依存がイメージに要る）、migrate 用に別の小さな lockfile を持つ（Prisma のバージョンを 2 か所で管理することになる）
- **確かめたこと**: 開発環境では Docker のデーモンが使えず、`docker build` は試せていない。代わりに各ステージの手順を手元で再現し、(1) まとめたジョブを node_modules のないディレクトリで実行して、フィクスチャで sync-static と collector が成功する、(2) 除いた後の依存で `prisma migrate deploy --config migrate/prisma.config.ts` が別のディレクトリから成功する、(3) standalone の `server.js` で `/api/health` が DB に接続できれば 200、できなければ 503 を返す、を確かめた。イメージ全体は T024 のコンテナの起動確認で確かめる
- **フィクスチャ**: イメージにはテスト用のフィクスチャを入れない。T024 で collector をフィクスチャで動かすときは、`tests/fixtures/mbta` をコンテナにマウントする

### 認証と権限

- **WIF の絞り込み**: deployer は OIDC トークンの `sub` クレーム（`repo:tsatolol/mbta_live:environment:<dev|prod>`）で、ci-builder は `repo:tsatolol/mbta_live:ref:refs/heads/main`（environment のないジョブ）で絞る。属性のマッピングに `environment` を足さずに済む
- **ci の plan**: contracts/pipeline.md では ci の GCP の認証は ci-builder だけなので、ci-builder に dev / prod の読み取り（`roles/viewer`、`roles/iam.securityReviewer`、`roles/serviceusage.serviceUsageConsumer`、state のバケットの `objectViewer`）を付けた。plan は `-lock=false` で実行する（ロックのオブジェクトを書かない）。deployer は environment のジョブでしか使えないので、ci からは使えない
- **deployer の権限**: modules/app の apply とデプロイに要るロール（`run.admin`、`cloudsql.admin`、`secretmanager.admin`、`cloudscheduler.admin`、`iap.admin`、`iam.serviceAccountAdmin`、`iam.serviceAccountUser`、`resourcemanager.projectIamAdmin`、`monitoring.editor`、`logging.configWriter`）。実行用の SA とその権限を modules/app で作るので `projectIamAdmin` が要る。deployer-prod は承認後のジョブでしか使えないことで守る
- **予算アラート（T037）**: 予算は請求先アカウントのリソースなので、deployer にはプロジェクトの権限だけでは足りない。T037 で、bootstrap に置くか deployer に請求先アカウントの権限を付けるかを決める

### 秘密の値

- **DB のパスワード**: ephemeral の `random_password` で作り、write-only の引数（`google_sql_user.password_wo`、`google_secret_manager_secret_version.secret_data_wo`）で入れる。plan と state にパスワードが残らないので、ci-builder が state を読めても問題がない。パスワードを変えるときは `db_password_version` を上げる
- **MBTA API キー**: Secret Manager の入れ物には値（バージョン）がないので、そのままジョブから参照するとデプロイが失敗しうる。変数 `mbta_api_key_enabled`（既定 false）で、値を入れてからジョブに渡す。キーがなくても収集は動く（キーなしの上限 20 req/分）
- **IAP で許可するユーザー**: メールアドレスが plan の出力（public リポジトリの Actions のログ）に出ないよう、`for_each` のキーにせず、`google_iap_web_cloud_run_service_iam_binding` の `members`（sensitive）で渡す

### Terraform の構成

- **envs の backend**: プロジェクト ID をコミットしないので、bucket を `terraform init -backend-config="bucket=<プロジェクト ID>-tfstate"` で渡す
- **envs のプロジェクト ID とイメージ**: `TF_VAR_project_id`（Environment の variable `GCP_PROJECT_ID`）と `TF_VAR_image`（CI でビルドしたダイジェスト）で渡す。イメージは最初に作るときだけ使い、以降の変更は `ignore_changes` で無視する（パイプラインが gcloud で更新する）。プレースホルダーのイメージで作ると、Scheduler が先に動いたときにジョブが失敗するため
- **Artifact Registry**: 古いイメージの自動削除（cleanup policy）は入れない。prod で動いているイメージを消すと、新しいインスタンスを起動できなくなる。容量が気になったら、prod のデプロイ履歴を見て消す仕組みを別に考える
- **ステートレスなリソースの削除保護**: Cloud Run のサービスとジョブは `deletion_protection = false`（作り直せる）。Cloud SQL だけ prod で守る
- **GitHub のリポジトリの設定**: `github_repository` を import し、`vulnerability_alerts` と `security_and_analysis` だけを管理する。それ以外の項目はプロバイダの既定値で画面の設定を上書きしないよう `ignore_changes` に入れた。Dependency graph は API で設定できないので画面の設定のまま
- **ルールセットの取り込み**: import のときにルールセットの ID が要るので、変数 `main_ruleset_id` で渡す

### 確かめたこと・未確認のこと

- 開発環境で、`terraform fmt -check`、modules/app と envs の `terraform validate`、bootstrap の GCP の部分（GitHub の部分を除いたもの）の `terraform validate` が通った。さらに `terraform test` のモックのプロバイダで、envs/prod と bootstrap（GCP の部分）の plan と apply が通ることを確かめた（値の形や依存関係の誤りを見つけるため。GCP の API の挙動は確かめられない）
- 未確認（T010 と T017 の最初の apply で確かめる）
  - 組織のないプロジェクトで、Cloud Run に直接組み込む IAP（`iap_enabled`）が使えるか。使えなければ外部 HTTPS LB + Serverless NEG + IAP に切り替える
  - IAP のサービスエージェント（`service-<番号>@gcp-sa-iap.iam.gserviceaccount.com`）と、dev の Cloud Run のサービスエージェントが、IAM の付与の時点で作られているか。作られていなければ、少し待って apply し直す

## T010 の結果（2026-11-03）

- bootstrap をローカルで apply し、dev（`mbta-live-dev-76bt`）と prod（`mbta-live-prod-76bt`）のプロジェクト、WIF、SA、GitHub の設定が作られた。エラーはなかった（quota project の設定も、サービスエージェントを待つ apply のやり直しも要らなかった）
- GitHub プロバイダは 6.13.0 が入った。`versions.tf` を `~> 6.13` にした
- 警告: `github_actions_environment_secret` の `plaintext_value` が非推奨（「Use value.」）。`value` に書き換えた。次に bootstrap を apply するとき、plan で secrets の差分がどう出るかを確かめる

## フェーズ 4 の実装で決めたこと（2026-11-03）

### ci で envs の plan を作るための入力の置き場所

- **問題**: ci ジョブは environment を持たないので、GitHub の Environment の variables（`GCP_PROJECT_ID`）と secrets（`TF_VAR_iap_members`）を読めず、dev / prod の plan を作れない
- **決定**: envs の入力を、イメージ（`TF_VAR_image`）を除いてリポジトリの中の値だけにする
  - プロジェクト ID は公開してよい値なので、`envs/<env>/terraform.tfvars` と `backend.tf`（state のバケット名）に書く
  - IAP で許可するユーザーは、bootstrap がプロジェクト単位の `roles/iap.httpsResourceAccessor`（`google_project_iam_binding`）で付ける（`bootstrap/iap.tf`）。メールアドレスを envs の入力にも plan の出力にも置かずに済む。smoke-tester もここで付ける
  - 監視の通知先は、bootstrap が各プロジェクトに通知チャンネル（表示名 `mbta-live alerts`）を作る（`bootstrap/monitoring.tf`）。T040〜T041 のアラートポリシーは、表示名でデータソースから探す
  - GitHub の Environment の secrets（`TF_VAR_iap_members`、`TF_VAR_alert_email`）はいらなくなったので、bootstrap から外した。次に bootstrap を apply すると削除される
- **検討した代替案**: リポジトリ全体の secrets にする（Environment で守る意味がなくなる）、plan だけを行う承認なしの Environment を足す（設定が増える）
- **未確認**: Cloud Run に直接組み込む IAP で、プロジェクト単位の IAP のアクセス権が効くか（IAM の継承で効くはず）。T029 の最初のスモークテストで確かめる

### web の起動の確認

- **決定**: Cloud Run の起動の確認（startup probe）は TCP にする。`/api/health`（DB への接続とテーブルの読み取り）はデプロイ後のスモークテストで確かめる
- **理由**: 最初の apply では、web を作る時点でマイグレーションがまだ適用されておらず、`/api/health` が 503 になって web を作れないため。DB に接続できないリビジョンは、dev ではスモークテストで、prod ではトラフィックを切り替える前の candidate のスモークテストで止まる

### マイグレーションの互換性テスト（TR-003）

- **方式**: prod で最後に成功したデプロイ（GitHub の Deployments API。environment `prod`）のコミットを `git worktree` で取り出す。新しいマイグレーションを適用した DB に対して、そのコミットの `pnpm test:integration` を `TEST_SKIP_MIGRATE=1` で実行する
  - `TEST_SKIP_MIGRATE=1` のとき、テストの開始時に DB を作り直さない（古いコミットのマイグレーションで上書きしない）。drift のテストは、DB が新しいスキーマなので差分が出るのが正しく、飛ばす
  - この仕組みは、この変更を含むコミットが prod に出た後から有効になる（古いコミットのテストがこのフラグを知っている必要があるため）
  - prod へのデプロイがまだないとき、新しいマイグレーションがないときは飛ばす
- **確かめたこと**: 開発環境で、列を足すマイグレーション（expand）では古いコミットの結合テストが通り、古いコードが使う列を消すマイグレーション（contract を先にした誤り）では 29 件が失敗してスクリプトが失敗することを確かめた

### plan のハッシュ（FR-007）

- **方式**: `terraform show -json` の `resource_changes` のうち no-op 以外の、アドレス・操作・`before`・`after`・`after_unknown` を、キーを並べ替えた JSON にして SHA-256 を取る（`scripts/plan-hash.sh`）
- 同じ設定と state からは同じハッシュになり、変更内容が変わればハッシュも変わることを、開発環境で random プロバイダの plan で確かめた
- DB のパスワードは write-only の引数なので、plan に値が出ずハッシュにも影響しない。イメージは ci と cd-prod で同じダイジェストを渡す
- ci の plan は ci-builder（読み取りだけ）で `-lock=false` で作る。plan の全文はログに出さず、件数とアドレスの要約（`scripts/plan-summary.sh`）だけを出す

### パイプラインの道具

- Gitleaks（リポジトリ全体）は、gitleaks-action が push のイベントでは push されたコミットしか見ないので、Gitleaks のコンテナイメージ（`ghcr.io/gitleaks/gitleaks:v8.24.3`。PR チェックと同じバージョン）で履歴全体を走査する
- GCP の認証は `google-github-actions/auth@v2` と `setup-gcloud@v2`、Terraform は `hashicorp/setup-terraform@v3`（Terraform 1.17.1）。PR チェックの actions と同じく、メジャーバージョンのタグで指定した（T047 で見直す）
- `pnpm test` から smoke を外した（`pnpm test:smoke` で別に実行する）

### 未確認（T030 で、最初のマージのときに確かめる）

- `docker build` とコンテナの起動確認（開発環境に Docker のデーモンがない）
- smoke-tester の ID トークンの audience。Cloud Run に直接組み込む IAP では、サービスの URL を audience にした ID トークンで通れるはず。通れなければ research.md に記録して直す
- WIF の認証情報で `gcloud auth print-identity-token --impersonate-service-account` が使えるか
- envs の最初の apply（Cloud SQL の作成に 10 分ほどかかる）と、その時点で Scheduler が collector を起動した場合の失敗（マイグレーションの前なので失敗するが、次の回からは成功する）
