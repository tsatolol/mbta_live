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

