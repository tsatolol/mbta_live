#!/usr/bin/env bash
# マイグレーションの互換性テスト（004 T025、TR-003）。
# 新しいマイグレーションを適用した DB に対して、prod で動いているコミットの結合テストを実行する。
# 成功すれば、新しいマイグレーションを適用した後も、prod の今のバージョン（ロールバック先）が動く。
#
# 使い方: scripts/check-migration-compat.sh <DATABASE_URL>
#   DATABASE_URL は互換性テスト専用の DB（中身は作り直される）
#   prod で動いているコミットは scripts/prod-deployed-sha.sh で取る（PROD_SHA で上書きできる）
set -euo pipefail

database_url="${1:?DATABASE_URL を指定してください}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

prod_sha="${PROD_SHA-$(scripts/prod-deployed-sha.sh)}"
if [ -z "$prod_sha" ]; then
  echo "prod へのデプロイがまだないので、互換性テストを飛ばします"
  exit 0
fi

new_migrations="$(git diff --name-only --diff-filter=A "$prod_sha" HEAD -- prisma/migrations | grep -c 'migration.sql$' || true)"
if [ "$new_migrations" = "0" ]; then
  echo "prod（$prod_sha）からの新しいマイグレーションがないので、互換性テストを飛ばします"
  exit 0
fi
echo "prod（$prod_sha）からの新しいマイグレーション: $new_migrations 件"

# 1. DB を作り直し、今のコミットのマイグレーションをすべて適用する
psql "$database_url" -v ON_ERROR_STOP=1 -q \
  -c 'DROP SCHEMA IF EXISTS "partitions" CASCADE' \
  -c 'DROP SCHEMA IF EXISTS "public" CASCADE' \
  -c 'CREATE SCHEMA "public"'
DATABASE_URL="$database_url" pnpm exec prisma migrate deploy

# 2. prod のコミットを取り出し、その結合テストを、マイグレーションを適用し直さずに実行する
worktree="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$worktree" >/dev/null 2>&1 || true
}
trap cleanup EXIT
git worktree add --detach "$worktree" "$prod_sha" >/dev/null
(
  cd "$worktree"
  pnpm install --frozen-lockfile
  TEST_DATABASE_URL="$database_url" TEST_SKIP_MIGRATE=1 pnpm test:integration
)
echo "互換性テストに成功しました（prod: $prod_sha）"
