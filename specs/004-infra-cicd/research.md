# Research: インフラと CI/CD

## GCP のプロジェクト構成: dev / prod の 2 プロジェクト

- **Decision**: dev と prod で別プロジェクト。イメージは prod プロジェクトの Artifact Registry に 1 つだけ置き、dev の Cloud Run サービスエージェントに読み取り権限を付ける
- **Rationale**: IAM・課金・クォータを分離でき、dev の操作ミスが prod に及ばない。同じイメージを昇格させるにはレジストリが 1 つのほうが簡単
- **Alternatives**: 共通 + dev + prod の 3 プロジェクト（分離はきれいだが管理対象が増える）、1 プロジェクト内で名前で分ける（IAM の分離が弱い）

## パイプラインの形: main への push で 1 本、承認ゲート

- **Decision**: main への push で CI → CD dev（自動）→ CD prod（GitHub Environments の Required reviewers で承認後）
- **Rationale**: 「CI 1 回・CD 2 回」を 1 本のワークフローで満たせる。リポジトリが public なので承認機能を無料で使える
- **Alternatives**: PR で CI と dev へのデプロイ、マージで prod（レビュー = PR のコードレビューになる案。ユーザーの判断で不採用）
- **Trade-off**: PR では CI が走らないので、壊れたコードに気づくのは main への push の後になる（その時点で dev / prod へのデプロイは止まる）。push 前にローカルでテストを実行するルールで補う

## 古い run の承認を防ぐ

- **Decision**: cd-prod は `github.sha` が main の HEAD でなければ失敗させる
- **Rationale**: 承認待ちの古い run を承認すると、古いイメージで prod を上書きしてしまうため

## 承認時と適用時のインフラ変更の一致

- **Decision**: CI で prod の plan の `resource_changes` のハッシュを出し、cd-prod で plan し直したときのハッシュと比べる
- **Rationale**: 承認者が見た変更内容と違うものが prod に適用されるのを防ぐ。plan ファイル自体は秘密の値を含みうるので、public リポジトリの artifact には置けない
- **Open**: ハッシュの作り方（unknown な値の扱いなど）は実装時に検証する

## Terraform の構成

- **Decision**: `bootstrap/`（最初に一度だけ手動で apply）、`modules/app/`（アプリ一式）、`envs/{dev,prod}/`（同じモジュールを呼び、変数だけ変える）。state は各環境のプロジェクトの GCS バケット
- **Rationale**: state バケットや WIF などパイプラインの前提になるものは、パイプラインでは作れない。環境の差を変数に閉じ込める

## 認証: Workload Identity Federation

- **Decision**: サービスアカウントのキーは使わない。WIF の attribute condition で `repository == tsatolol/mbta_live` かつ `ref == refs/heads/main` に限定し、deployer SA の利用は OIDC トークンの `environment` クレームで絞る（deployer-prod は `environment == prod` のジョブだけ）
- **Rationale**: キーの漏えいリスクがない。public リポジトリでも、main 以外やフォークからは使えない

## IAP

- **Decision**: Cloud Run に直接組み込む方式（`--iap`）。使えない場合は外部 HTTPS LB + Serverless NEG + IAP
- **Rationale**: ロードバランサが不要でコストが小さい

## マイグレーション

- **Decision**: デプロイの前に migrate Job（`prisma migrate deploy`）を実行する。マイグレーションは expand → contract で書く
- **Rationale**: 1 つ前のイメージでも動くので、ロールバックはイメージの差し替えだけで済む。dev が先に通るので、壊れたマイグレーションは dev で止まる

## dev のコスト

- **Decision**: dev は collector 5 分間隔、生データ 3 日保持、Cloud SQL のバックアップ 1 日
- **Rationale**: dev の分析画面は表示の確認用と割り切り、数値の妥当性は prod で確認する
