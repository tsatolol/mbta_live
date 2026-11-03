# 契約: ワークフロー（`pr-checks.yml`・`pipeline.yml`・`rollback.yml`）と GitHub の設定

main はブランチ保護で PR 経由の更新だけを受け付ける。変更 1 つは次の順に進む。

```
PR を開く / 更新        → pr-checks.yml（軽いチェック。合格がマージの条件）
PR をマージ（= main への push） → pipeline.yml（リリース用の CI 1 回 → CD dev → 承認 → CD prod）
```

## pr-checks.yml

- トリガー: `pull_request`（main 向け）。フォークからの PR でも動くが、GCP の認証情報も Environment の secrets も使わない。`pull_request_target` は使わない
- 内容（5 分以内を目安にする）:
  1. `pnpm install` → lint → typecheck → 単体テスト（`pnpm test:unit`。DB を使わないもの）
  2. 秘密の値の混入検査（Gitleaks。PR の差分）
  3. 依存関係の検査（`actions/dependency-review-action`。PR で追加・更新した依存に high 以上の脆弱性があれば失敗）
- ブランチ保護で、このワークフローの合格をマージの必須条件にする

## pipeline.yml

トリガーは main への push だけ（ブランチ保護により、実際には PR のマージだけ）。main の更新 1 回につき、リリース用の CI 1 回、CD 2 回。

```
push to main（PR のマージ）
  │
  ├─ ci            （environment なし。GCP の認証は ci-builder だけ）
  │    pnpm install → lint → typecheck
  │    → unit / integration / replay（Postgres サービスコンテナ）→ Playwright（フィクスチャ）
  │    → マイグレーションの互換性テスト（新しいマイグレーションを適用した DB に、prod で動いているコミットの結合テストを実行。TEST_SKIP_MIGRATE=1）
  │    → セキュリティ検査: pnpm audit（high 以上で失敗）、Gitleaks（リポジトリ全体）
  │    → docker build
  │    → コンテナの起動確認: テスト用 DB に向けてイメージを起動し、/api/health が 200、
  │      migrate と collector（MBTA_FIXTURE_MODE=1）の起動コマンドが成功することを確かめる
  │    → Artifact Registry に push（タグ = git SHA）→ outputs: image_digest
  │    → terraform fmt -check / validate → dev と prod の terraform plan（ci-builder の読み取り権限、-lock=false）
  │    → outputs: prod_plan_hash（prod の plan の resource_changes のハッシュ）
  │    → 承認用のサマリーをジョブサマリーに出す（下記）
  │
  ├─ cd-dev        （environment: dev / 承認なし / needs: ci）
  │    WIF で deployer-dev として認証
  │    → terraform apply（envs/dev）
  │    → migrate Job をそのイメージで実行（prisma migrate deploy）
  │    → web をデプロイ（トラフィック 100%）、各 Job のイメージを更新（どちらもダイジェスト指定）
  │    → スモークテスト（下記）
  │    → dev での E2E: 読み取りだけの短い Playwright を dev の URL に対して実行（IAP を通す）
  │
  └─ cd-prod       （environment: prod / Required reviewers で承認待ち / needs: cd-dev）
       github.sha が main の HEAD でなければ失敗
       → WIF で deployer-prod として認証
       → terraform plan（envs/prod）し、ハッシュが prod_plan_hash と違えば失敗
       → terraform apply（envs/prod）
       → Cloud SQL のオンデマンドバックアップを取る（新しいマイグレーションがあるときだけ）
       → migrate Job をそのイメージで実行
       → web の新しいリビジョンをトラフィック 0%、タグ `candidate` 付きでデプロイ
       → タグ付き URL に対してスモークテスト。失敗したらトラフィックを切り替えずに終了
       → トラフィックを新しいリビジョンに 100% 切り替え
       → 本番 URL に対してスモークテスト。失敗したら直前のリビジョンにトラフィックを戻して失敗
       → 各 Job のイメージを更新 → collector Job を 1 回実行（--wait）して成功を確認
```

### スモークテスト

監視・テスト用の SA（`smoke-tester`）の ID トークンで IAP を通して、次を確かめる。

1. `/api/health` が 200 で、DB に接続できている
2. 主要な内部 API（`/api/live/vehicles`, `/api/static/routes`, `/api/live/alerts`）が 200 を返し、応答が共有の zod スキーマで解析できる
3. 認証なしのリクエストは IAP で拒否される（401 / 403 / ログイン画面へのリダイレクト）
4. dev では collector Job を 1 回実行（--wait）して成功する（Secret Manager、DB、MBTA API キーの設定の確認を兼ねる）

prod のスモークテストは読み取りだけにする。データを書き込むのは、通常の運用と同じ collector の実行だけ。

### 承認用のサマリー

ci のジョブサマリーに次を出し、prod の承認時に確認する。

- prod で今動いているコミット（GitHub の Environment `prod` の最後の成功デプロイ）から今回のコミットまでのコミット一覧
- 追加されるマイグレーションのファイル名
- dev と prod の terraform plan の要約（変更・追加・削除の件数と対象のリソース。秘密の値は出さない）
- テストとセキュリティ検査の結果

### その他

- `concurrency`: ci は `pipeline-main`、デプロイは `deploy-dev` / `deploy-prod`。`cancel-in-progress: false`
- plan のハッシュの比較方式、IAP の背後にあるタグ付き URL への ID トークンでのアクセス、dev の E2E で IAP を通す方法は、実装時に検証する

## rollback.yml

- トリガー: `workflow_dispatch`。入力は `environment`（`dev` / `prod`）と `image_digest`（省略時は web の直前のリビジョンにトラフィックを戻すだけ）
- `environment:` に入力値を指定するので、prod では承認が必要
- web のトラフィックの切り替えと各 Job のイメージの差し替えだけを行う。Terraform の apply とマイグレーションは実行しない
- 終わったらスモークテストを実行する

## GitHub の設定

### main のブランチ保護（ルールセット `main`）

- PR 経由のマージだけを許可する（直接 push は不可）
- `pr-checks` の合格を必須にする
- 承認者の人数は 0（オーナー 1 人で開発するため。コードのレビューは任意）
- force push と削除を禁止する

### Environment

| 項目 | dev | prod |
|---|---|---|
| 保護ルール | なし | Required reviewers（リポジトリのオーナー） |
| Deployment branches | `main` だけ | `main` だけ |
| variables | `GCP_PROJECT_ID`, `WIF_PROVIDER`, `DEPLOYER_SA`, `SMOKE_TESTER_SA` | 同左 |

リポジトリ全体の variables: `ARTIFACT_REGISTRY`（prod プロジェクトのリポジトリ）、`CI_BUILDER_SA`、`CI_WIF_PROVIDER`。

その他: Dependency graph、Dependabot alerts、secret scanning と push protection を有効にする（public リポジトリでは無料。Dependency graph がないと依存関係の検査が動かない）。

Environment の secrets は置かない。IAP で許可するユーザーと監視の通知先は、bootstrap が GCP に直接設定する（ci ジョブは Environment の variables と secrets を読めないので、envs の入力をリポジトリの中の値だけにして、ci で plan を作れるようにするため）。

この節の設定（ルールセット、Environment・variables、リポジトリの variables、セキュリティ設定）は、すべて bootstrap の Terraform（`infra/terraform/bootstrap/github.tf`）が作る。画面で変えない。web の URL は variables に置かず、ジョブの中で `gcloud run services describe` で取得する。

## 守ること

- plan ファイルは artifact としてアップロードしない。ログに秘密の値を出さない（public リポジトリのため）
- 環境ごとの値はビルド時ではなく実行時の環境変数で渡す
- prod の認証情報（deployer-prod）は、承認後のジョブ（cd-prod と rollback の prod）でしか使えない
