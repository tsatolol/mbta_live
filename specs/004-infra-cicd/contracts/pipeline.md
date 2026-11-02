# 契約: パイプライン（`.github/workflows/pipeline.yml`）とロールバック（`rollback.yml`）

## pipeline.yml

トリガーは main への push だけ。1 回の push で CI 1 回、CD 2 回。

```
push to main
  │
  ├─ ci            （environment なし）
  │    pnpm install → lint → typecheck → unit / integration / replay（Postgres サービスコンテナ）→ Playwright（フィクスチャ）
  │    → マイグレーションの互換性テスト（新しいマイグレーションを適用した DB に、prod で動いているコミットの結合テストを実行）
  │    → docker build → Artifact Registry に push（タグ = git SHA）→ outputs: image_digest
  │    → terraform fmt -check / validate → dev と prod の terraform plan（結果をジョブサマリーに出す）
  │    → outputs: prod_plan_hash（prod の plan の resource_changes のハッシュ）
  │
  ├─ cd-dev        （environment: dev / 承認なし / needs: ci）
  │    WIF で deployer-dev として認証
  │    → terraform apply（envs/dev）
  │    → migrate Job をそのイメージで実行（prisma migrate deploy）
  │    → web をデプロイし、各 Job のイメージを更新（どちらもダイジェスト指定）
  │    → スモークテスト: collector Job を 1 回実行（--wait）して成功を確認
  │
  └─ cd-prod       （environment: prod / Required reviewers で承認待ち / needs: cd-dev）
       github.sha が main の HEAD でなければ失敗
       → WIF で deployer-prod として認証
       → terraform plan（envs/prod）し、ハッシュが prod_plan_hash と違えば失敗
       → 以降は cd-dev と同じ手順を prod で実行
```

- `concurrency`: CI は `pipeline-main`、デプロイは `deploy-dev` / `deploy-prod`。`cancel-in-progress: false`
- plan のハッシュの比較方式は実装時に検証する

## rollback.yml

- トリガー: `workflow_dispatch`。入力は `environment`（`dev` / `prod`）と `image_digest`
- `environment:` に入力値を指定するので、prod では承認が必要
- web と各 Job のイメージを差し替えるだけ。Terraform の apply とマイグレーションは実行しない

## GitHub の設定

| 項目 | dev | prod |
|---|---|---|
| Environment の保護ルール | なし | Required reviewers（リポジトリのオーナー） |
| Deployment branches | `main` だけ | `main` だけ |
| variables | `GCP_PROJECT_ID`, `WIF_PROVIDER`, `DEPLOYER_SA` | 同左 |
| secrets | `TF_VAR_iap_members` など | 同左 |

リポジトリ全体の variables: `ARTIFACT_REGISTRY`（prod プロジェクトのリポジトリ）、`CI_BUILDER_SA`、`CI_WIF_PROVIDER`。

## 守ること

- plan ファイルは artifact としてアップロードしない。ログに秘密の値を出さない（public リポジトリのため）
- 環境ごとの値はビルド時ではなく実行時の環境変数で渡す
