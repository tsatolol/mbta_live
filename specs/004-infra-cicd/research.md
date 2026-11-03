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

- **WIF の絞り込み**: 最初は OIDC トークンの `sub` クレーム（deployer は `repo:tsatolol/mbta_live:environment:<dev|prod>`、ci-builder は `repo:tsatolol/mbta_live:ref:refs/heads/main`）で 1 つの principal に絞った。最初のパイプラインの実行で、ci-builder の利用が `iam.serviceAccounts.getAccessToken` で拒否された（トークンの交換は通り、SA の付与と一致しなかった）。`sub` の形に頼らない方式に変えた（下の「パイプラインの最初の実行」）
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
- WIF の認証情報で `gcloud auth print-identity-token --impersonate-service-account` が使えるか（run #4 で使えないと分かった。下の「4 回目の実行」）
- envs の最初の apply（Cloud SQL の作成に 10 分ほどかかる）と、その時点で Scheduler が collector を起動した場合の失敗（マイグレーションの前なので失敗するが、次の回からは成功する）

## パイプラインの最初の実行（2026-11-03、run #1）

- ci: lint からコンテナの起動確認まで合格した。`docker build`（約 1 分）とコンテナの起動確認（migrate、フィクスチャでの sync-static と collector、`/api/health`）が、開発環境では試せなかった分も含めて動くことを確かめた。マイグレーションの互換性テストは、prod へのデプロイがまだないので飛ばした
- 失敗: イメージの push の前の、ci-builder としての認証で `Permission 'iam.serviceAccounts.getAccessToken' denied`。トークンの交換（attribute condition）は通っており、`sub` で絞った SA の付与（`principal://.../subject/repo:...:ref:refs/heads/main`）が実際のトークンと一致しなかった
- **対応**: `sub` の形に頼らず、pool を分けて provider の attribute condition で絞り、SA には pool 全体（`principalSet://.../workloadIdentityPools/<pool>/*`）を付ける
  - pool `github`（dev / prod の各プロジェクト）: 条件は「このリポジトリの main」かつ「`environment` クレームがその環境」。deployer-<env> だけを付ける
  - pool `github-ci`（prod のプロジェクト。新規）: 条件は「このリポジトリの main」。ci-builder だけを付ける。GitHub の variable `CI_WIF_PROVIDER` はこの provider に変わる
  - environment のないジョブは `environment` クレームがないので、pool `github` の条件を満たさない（deployer を使えない）
- 警告: `google-github-actions/auth@v2`、`setup-gcloud@v2`、`pnpm/action-setup@v4` が Node.js 20 向けで、Node.js 24 で強制的に動かされている。T047 で新しいメジャーバージョンに上げる

## パイプラインの 2 回目の実行（2026-11-03、run #2）

- WIF の修正で、ci-builder としての認証とイメージの push が通った
- 失敗 1: ci の plan で、state がまだない（最初のデプロイの前）ため、GCS の backend の `terraform init` が空の state とロックのオブジェクトを書こうとして、読み取りだけの ci-builder では `storage.objects.create` が拒否された。`-lock=false` を付けても、GCS の backend は state がないときに空の state を書く
  - **対応**: state のオブジェクトがまだない環境（`gcloud storage ls` が「matched no objects」で失敗したとき）だけ、`backend_override.tf` で local の backend に切り替え、空の state で plan する。state がない場合は GCS でもローカルでも plan の結果は同じなので、prod の plan のハッシュも cd-prod の plan と一致する。ls がほかの理由（権限など）で失敗したときは止める
- 失敗 2: `docker inspect` の `RepoDigests` の最初の要素が、Artifact Registry ではなくローカルの名前（`mbta-live@sha256:...`）だった。Artifact Registry のパスで始まるものを選ぶようにした

## パイプラインの 3 回目の実行（2026-11-03、run #3）

- ci はすべて合格した（plan は dev / prod とも空の state で作られた）
- cd-dev: Terraform の apply で、Cloud SQL（作成に約 9 分）、DB とユーザー、Secret Manager、実行用の SA などが作られた。Cloud Run のサービスとジョブの作成で `Permission 'artifactregistry.repositories.downloadArtifacts' denied`（prod のプロジェクトの Artifact Registry）
  - dev の Cloud Run のサービスエージェントには読み取り権限を付けてあった。作成を呼び出した deployer 自身にもイメージを読む権限が要ると判断し、両方の deployer に Artifact Registry のリポジトリの `roles/artifactregistry.reader` を付けた（`bootstrap/iam.tf`）。prod の deployer も同じ理由で失敗するはずなので、一緒に付けた

## パイプラインの 4 回目の実行（2026-11-03、run #4）

- ci は合格。cd-dev は Terraform の apply（Cloud Run の web とジョブの作成）、migrate Job の実行、web のデプロイ、各ジョブのイメージの更新まで成功した。deployer に Artifact Registry の読み取り権限を付けたことで、run #3 の失敗は解消した
- 失敗: スモークテストの前の ID トークンの発行で `iam.serviceAccounts.getAccessToken` が拒否された。`gcloud auth print-identity-token --impersonate-service-account` は、ID トークンの前に smoke-tester のアクセストークンも取ろうとするため、Token Creator の権限が要る。deployer には ID トークンの発行（`roles/iam.serviceAccountOpenIdTokenCreator`）しか付けていない
- **対応**: 権限は広げず、IAM Credentials API の `generateIdToken` を deployer のアクセストークンで直接呼ぶスクリプト（`scripts/smoke-id-token.sh`）にした

## IAP の OAuth クライアント（2026-11-03、run #5）

- run #5: cd-dev は ID トークンの発行まで成功し、スモークテストが 2 件とも 502 で失敗した（認証なしも 502）。応答は IAP が返したもの（`x-goog-iap-generated-response: true`）で、本文は「Empty Google Account OAuth client ID(s)/secret(s).」。web 自体は正常に起動していた（Cloud Run のログ）
- 原因: 組織のないプロジェクトでは、Cloud Run に直接組み込む IAP が Google の用意する OAuth クライアントを使えない（`gcloud iap oauth-brands list` が「Project must belong to an organization」）。IAP の OAuth Admin API（brands / clients）は 2026-03 に廃止されていて、OAuth クライアントを API や Terraform で作れない
- **決定**: OAuth クライアント（Web アプリケーション）を Cloud Console の Google Auth Platform で環境ごとに作り（人が行う。quickstart.md の 2.5）、クライアント ID とシークレットを bootstrap の変数 `iap_oauth_clients` で渡す。bootstrap が `google_iap_settings`（プロジェクト単位の `projects/<番号>/iap_web`）の `oauth_settings` に入れ、GitHub の Environment の variable `IAP_CLIENT_ID` を登録する。シークレットは bootstrap の state（公開アクセスを禁止したバケット）に残る
- スモークテストの ID トークンの audience は、web の URL ではなく OAuth クライアントの ID にする（IAP のプログラムからの認証は、IAP の OAuth クライアントの ID を audience とする）
- スモークテストは、5xx のときに応答の本文をログに出すようにした（原因を調べるため。秘密の値は含まない）
- **検討した代替案**: プロジェクトを組織に入れる（Cloud Identity の無料版と独自ドメインが要り、手間が大きい）、外部 HTTPS LB + IAP（同じく OAuth クライアントが要るうえ、LB の費用がかかる）
- **未確認**: プロジェクト単位の IAP の設定で、Cloud Run の web に OAuth クライアントが効くか。効かなければ、サービス単位（`projects/<番号>/iap_web/cloud_run-us-east4/services/web`）に設定する

## パイプラインの 6 回目の実行（2026-11-03、run #6）: 初めて最後まで成功

- dev の OAuth クライアントを作って bootstrap を apply した後、ブラウザで dev の web を開くと Google のログイン画面が出た。プロジェクト単位の IAP の設定（`projects/<番号>/iap_web`）で、Cloud Run の web にも OAuth クライアントが効いた
- run #6 で ci → cd-dev が最後まで成功した: Terraform の apply、migrate、web のデプロイ、ジョブの更新、スモークテスト（IAP を通した `/api/health` が 200、認証なしは拒否）、collector の 1 回の実行
- 次のことを実際に確かめた: smoke-tester の ID トークン（audience = IAP の OAuth クライアントの ID、`generateIdToken` で発行）で IAP を通れる。プロジェクト単位の `roles/iap.httpsResourceAccessor` が Cloud Run の web に効く
- マージ（push）から cd-dev の完了まで約 5 分 20 秒（SC-002 の 20 分以内）。2 回目以降の実行なので、Cloud SQL の作成（約 9 分）は含まない

## 非推奨の警告への対応（2026-11-03）

- **Dependabot alerts**: `github_repository` の `vulnerability_alerts` は、GitHub プロバイダ 6.12 で非推奨になった（「Use the github_repository_vulnerability_alerts resource instead.」）。引数を外し、`github_repository_vulnerability_alerts`（引数は `repository` と `enabled`。既定は true）に移した。既存の設定は import ブロック（ID はリポジトリ名）で取り込む。元の引数は Optional かつ Computed なので、外しても `github_repository` に差分は出ない。プロバイダ 6.13.0 のソースと文書で確かめた
- **GitHub Actions**: Node.js 20 向けで警告が出ていた actions を、Node.js 24 で動く最新のメジャーバージョンに上げた。使っている入力（auth の `workload_identity_provider` / `service_account`、setup-terraform の `terraform_version` / `terraform_wrapper`、pnpm は `package.json` の `packageManager` を読む）は、新しいバージョンにも残っていることを各 action の `action.yml` で確かめた
  - `google-github-actions/auth` v2 → v3、`google-github-actions/setup-gcloud` v2 → v3（`skip_tool_cache` の削除。使っていない）
  - `hashicorp/setup-terraform` v3 → v4（Node.js 24 が必要になったこと以外の互換性のない変更なし）
  - `pnpm/action-setup` v4 → v6（pnpm 11 / 12 への対応）
  - バージョンは引き続きメジャーバージョンのタグで指定する。SHA での固定と Dependabot の version updates は T047 で見直す

## フェーズ 5 の実装で決めたこと（2026-11-03）

- **cd-prod の流れ**: 承認（Environment `prod` の Required reviewers）→ `github.sha` が main の最新か（`gh api repos/.../commits/main`）→ deployer-prod で認証 → plan して、ハッシュが ci の `prod_plan_hash` と同じかを確かめる → **確かめた plan ファイルをそのまま apply** する（plan と apply の間に変わらないように）→ 新しいマイグレーションがあればバックアップ → migrate → web を `--no-traffic --tag candidate` でデプロイ → candidate の URL でスモークテスト → トラフィックを新しいリビジョンに 100% → 本番の URL でスモークテスト（失敗したら直前のリビジョンに戻して失敗）→ 各ジョブのイメージの更新 → collector の 1 回の実行
- **戻し先のリビジョン**: candidate をデプロイする前に、トラフィックが 100% のリビジョンを記録しておく。切り替えは `--to-revisions=<新しいリビジョン>=100` で、リビジョンを名前で指定する（`--to-latest` は、途中で別のリビジョンができたときに意図と違うものを指しうるため）
- **新しいマイグレーションの判定**: prod で最後に成功したデプロイのコミット（`scripts/prod-deployed-sha.sh`）からの差分に `migration.sql` が追加されているか。最初のリリースではデータがないので、バックアップを取らない。`gcloud sql backups create` は `--async` を付けず、完了を待つ
- **スモークテストのスクリプト**: dev / candidate / 本番の 3 か所で使うので、ID トークンの発行と `pnpm test:smoke` を `scripts/smoke.sh` にまとめた
- **最初のリリースの例外**: prod の web は Terraform の最初の apply で、そのイメージのリビジョンがトラフィック 100% で作られる。その後の candidate は同じイメージの 2 つ目のリビジョンになる。最初のリリースでは利用者がいないので、段階的な切り替えの効果はないが、流れは同じに動く
- **未確認（最初の prod へのデプロイで確かめる）**: Cloud Run に直接組み込む IAP が、タグ付きの URL（`https://candidate---web-....a.run.app`）も守るか。守らない場合、candidate の「認証なしは拒否」のテストが失敗してデプロイが止まる（利用者には影響しない）。そのときは candidate のスモークテストの方式を見直す

## 最初の prod へのデプロイ（2026-11-03、run #8）

- ci → cd-dev → 承認 → cd-prod がすべて成功し、prod（`mbta-live-prod-76bt`）で web と収集（1 分ごと）が動き始めた
- cd-prod: main の最新の確認、plan のハッシュの照合（ci の plan と一致。ci は空のローカルの state、cd-prod は GCS の空の state で plan したが、ハッシュは同じになった）、apply（Cloud SQL の作成を含めて約 6 分）、バックアップ（最初のリリースなので飛ばした）、migrate、candidate のデプロイ、candidate のスモークテスト、トラフィックの切り替えと本番のスモークテスト、ジョブの更新、collector の 1 回の実行
- **IAP はタグ付きの URL も守る**: candidate の URL（`https://candidate---web-....a.run.app`）に対するスモークテストで、ID トークン付きの `/api/health` が 200、認証なしは拒否された（未確認だった点を確かめた）
- 承認から cd-prod の完了まで約 8 分 20 秒（SC-003 の 15 分以内）。2 回目以降は Cloud SQL の作成がないので、さらに短くなる

## T030 の後半と T034 の確認（2026-11-03）

- **T030 の後半**（run #10）: わざと失敗する結合テストを入れた PR は、pr-checks（単体テストだけ）に合格してマージできた。マージ後のパイプラインでは ci の結合テストで失敗し、イメージのビルドも push もされず、cd-dev と cd-prod は skipped（dev にも prod にもデプロイされない）
- **T034 の (3)**（run #11、cd-prod の 1 回目）: `/api/health` が prod でだけ 503 を返す一時的な変更で、candidate（`web-00006-kic`）のスモークテストが 503 で失敗し、トラフィックを切り替えるステップは動かなかった。利用者は直前のリビジョン（`web-00004-qud`）を使い続け、prod の `/api/health` は 200 のままだった。認証なしのリクエストは candidate でも IAP で拒否された
- **T034 の (2)**（run #11、cd-prod の再実行）: 手順の想定とは順番が違った。prod の sync-static の Scheduler の一時停止が ci の plan の前に行われていて、承認時の plan に「sync-static の変更（再開）」が入った（承認用のサマリーにも出ていた）。1 回目の cd-prod は承認時と同じ plan だったので apply し、Terraform が Scheduler を元に戻した。再実行では plan が「変更なし」になり、承認時（変更 1 件）とハッシュが違うので「適用しません」で止まった。承認の後に prod の状態が変わると適用されないことは、これで確かめられた
  - Cloud Scheduler の一時停止（`paused`）は、Terraform の plan で差分として検出される
- **T034 の (1)**（run #11 の 3 回目）: 503 の変更を元に戻した PR（run #12）で main が進み、prod が正常なリビジョンに戻った後に、古い run #11 の cd-prod を再実行して承認した。最初のステップ「Require the latest main」で失敗し、認証・apply・デプロイは動かなかった（503 を返すイメージは prod に出なかった）
- 確認のために main に入れた一時的な変更（失敗するテスト、prod だけの 503）は、PR #28 と PR #29 で元に戻した

## フェーズ 6〜9 の実装で決めたこと（2026-11-03）

### ロールバック（T035）

- **決定**: `rollback.yml`（`workflow_dispatch`）。`image_digest` がなければ、web のトラフィックを `previous` タグのリビジョンに戻す。あれば、web と各ジョブをそのイメージに差し替える。Terraform の apply とマイグレーションは実行しない。終わったらスモークテスト
- **直前のリビジョンの見つけ方**: cd-dev と cd-prod が、トラフィックを新しいリビジョンに移したら、それまで流れていたリビジョンに `previous` タグを付ける（`gcloud run services update-traffic --update-tags`）。作成日時の順で 1 つ前のリビジョンを選ぶと、スモークテストで止めた candidate（T034 の `web-00006-kic` のような壊れたリビジョン）を選んでしまうため
- `concurrency` はパイプラインのデプロイと同じ `deploy-<env>` にして、重ならないようにした。入力（`image_digest`）はスクリプトに埋め込まず環境変数で渡し、Artifact Registry のダイジェストの形かを確かめる

### 予算アラート（T037）

- **決定**: 予算は請求先アカウントのリソースなので、パイプラインの deployer（プロジェクトの権限だけ）ではなく、bootstrap（請求先アカウントの権限がある人）で作る。変数 `monthly_budgets`（環境ごとの月の予算）と `budget_currency_code`（請求先アカウントの通貨。既定 JPY）。予算額は未定なので、書いた環境だけ作る
- 50%・90%・100% と、月末の見込みが 100% で、監視の通知チャンネルと請求先アカウントの管理者にメールが届く
- Billing Budget API はユーザーの認証情報で呼ぶときに割り当てのプロジェクトが要るので、予算だけ prod のプロジェクトを `billing_project` にしたプロバイダ（`google.billing`）で作る
- **未確認**: bootstrap の apply（予算額を決めたとき）

### 監視（T039〜T041）

- **ジョブの終了ログ**: `src/jobs/runner.ts` の終了ログに `job`・`status`・`counts` が必ず入る。監視に要る件数以外の項目は `JobOutcome.logFields` で足す。collector は `inServiceHours`（運行時間中か）、`rejectedRowRatio`（解析に失敗した行の割合）、`aggregateOverdue`（後述）を出す。結合テスト（`tests/integration/job-end-log.test.ts`）で確かめる
- **ログベースの指標とアラートポリシー**（`modules/app/monitoring.tf`）:
  | 条件（FR-013・FR-020） | 指標 | アラートの条件 |
  |---|---|---|
  | 最後の収集成功から 3 分以上 | collector の成功の回数 | 成功が `collector_absence_seconds` 秒ない（prod 180 秒、dev 900 秒） |
  | 運行時間中（05:30〜24:00 ET）の車両 0 件 | 運行時間中の車両数（分布） | p99 が 1 未満、10 分間 |
  | 解析に失敗した行の割合が 1% 超 | `rejectedRowRatio`（分布） | p99 が 0.01 超 |
  | `unknown_stop_ids` の未解決分の増加 | 駅一覧にない stop ID の数（分布） | 1 件以上が 60 分続く（sync-static は毎日 04:00 なので、新しい駅は最大で約 1 日残る。続くときだけ通知する） |
  | 05:00 ET 時点で前日分の集計が未完了 | collector が `aggregateOverdue=true` を出した回数 | 1 回以上 |
  | web の 5xx の割合 5% 超（5 分） | Cloud Run の `request_count` | 5xx / 全体 > 0.05 |
  | web の応答時間の p95 が 3 秒超 | Cloud Run の `request_latencies` | p95 > 3,000 ms |
- **運行時間の判定**は Cloud Monitoring の条件では夏時間を扱いにくいので、アプリ（`src/lib/time.ts` の `isInServiceHours`）で判定してログに出す
- **集計の遅れ**: ログがないことの条件（absence）で「毎日 1 回の aggregate の成功」を見るには 24 時間を超える期間が要り、上限を確かめられなかった。そこで collector が毎回「05:00 ET を過ぎても、今の運行日（03:00 ET から）に aggregate が一度も成功していないか」（`isAggregateDeadlinePassed` と `collector_runs`）をログに出す。集計（003）が入る前は aggregate はパーティションの管理だけだが、ジョブが動いて成功したかは同じように見られる。003 で集計が入ったら、集計の失敗は aggregate の失敗になるので、同じ監視で見られる
- **稼働時間チェックはやめた**: `/api/health` は IAP の背後にある。稼働時間チェックの ID トークン（Monitoring のサービスエージェント）の audience を、IAP の OAuth クライアントの ID に合わせられない。収集の途絶と集計の遅れは上のログで見られるので、稼働時間チェックは作らない
- **dev は通知しない**: `alert_notifications_enabled = false`。ポリシーは作るので、Cloud Monitoring の画面で状態を見られる（TR-005 の確認は dev で条件を起こし、画面と、一時的に通知を有効にしたときのメールで確かめる）
- **未確認（T042 で確かめる）**: 分布の指標の p99 で、0 件・1% などの境界が意図どおりに判定されるか。条件を起こしたときに通知が届くか
