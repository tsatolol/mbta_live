#!/usr/bin/env bash
# デプロイ後のスモークテストを実行する（TR-002）。smoke-tester の ID トークンを発行し、IAP を通して pnpm test:smoke を動かす。
# 使い方: scripts/smoke.sh <対象の URL>
#   環境変数 SMOKE_TESTER_SA（smoke-tester の SA）と IAP_CLIENT_ID（IAP の OAuth クライアントの ID。ID トークンの audience）が必要。
#   gcloud は deployer として認証済みであること（smoke-tester の ID トークンを発行できる）
set -euo pipefail

url="${1:?対象の URL を指定してください}"
: "${SMOKE_TESTER_SA:?SMOKE_TESTER_SA を設定してください}"
if [ -z "${IAP_CLIENT_ID:-}" ]; then
  echo "GitHub の Environment の variable IAP_CLIENT_ID がありません（bootstrap の iap_oauth_clients）" >&2
  exit 1
fi
root="$(cd "$(dirname "$0")/.." && pwd)"

token="$("$root/scripts/smoke-id-token.sh" "$SMOKE_TESTER_SA" "$IAP_CLIENT_ID")"
# トークンはログで伏せ字にする（GitHub Actions のワークフローコマンドは標準出力から読まれる）
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::$token"
fi
echo "スモークテスト: $url"
SMOKE_BASE_URL="$url" SMOKE_ID_TOKEN="$token" pnpm --dir "$root" test:smoke
