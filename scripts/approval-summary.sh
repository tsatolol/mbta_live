#!/usr/bin/env bash
# prod の承認用のサマリーを Markdown で出力する（004 T028、FR-021）。ci ジョブの最後に $GITHUB_STEP_SUMMARY に書く。
#   - prod で今動いているコミットから今回のコミットまでのコミット一覧
#   - 追加されるマイグレーション
#   - dev と prod の terraform plan の要約（件数と対象のリソース。値は出さない）
#   - テストとセキュリティ検査の結果
#
# 使い方: scripts/approval-summary.sh <dev の plan の JSON> <prod の plan の JSON>
#   prod で動いているコミットは scripts/prod-deployed-sha.sh で取る（PROD_SHA で上書きできる）
set -euo pipefail

dev_plan="${1:?dev の plan の JSON を指定してください}"
prod_plan="${2:?prod の plan の JSON を指定してください}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

head_sha="$(git rev-parse HEAD)"
prod_sha="${PROD_SHA-$(scripts/prod-deployed-sha.sh)}"

echo "# prod へのリリースの確認"
echo
echo "今回のコミット: \`$head_sha\`"
echo

echo "## コミット"
echo
if [ -z "$prod_sha" ]; then
  echo "prod へのデプロイはまだない（最初のリリース）"
else
  echo "prod で動いているコミット: \`$prod_sha\`"
  echo
  git log --format='- `%h` %s' "$prod_sha..$head_sha"
fi
echo

echo "## 追加されるマイグレーション"
echo
if [ -z "$prod_sha" ]; then
  migrations="$(find prisma/migrations -name migration.sql | sort)"
else
  migrations="$(git diff --name-only --diff-filter=A "$prod_sha" "$head_sha" -- prisma/migrations | grep 'migration.sql$' || true)"
fi
if [ -z "$migrations" ]; then
  echo "なし"
else
  echo "$migrations" | while read -r f; do echo "- \`$(basename "$(dirname "$f")")\`"; done
fi
echo

echo "## インフラの変更（terraform plan）"
echo
echo "### dev"
echo
scripts/plan-summary.sh "$dev_plan"
echo
echo "### prod"
echo
scripts/plan-summary.sh "$prod_plan"
echo

echo "## テストとセキュリティ検査"
echo
echo "このサマリーは ci ジョブのすべての検査に合格した後に作られる: lint、型チェック、unit / integration / replay、"
echo "マイグレーションの互換性テスト、pnpm audit（high 以上）、Gitleaks（リポジトリ全体）、コンテナの起動確認、terraform fmt / validate / plan"
