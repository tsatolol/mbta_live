#!/usr/bin/env bash
# dev での E2E を実行する（004 T049、TR-007）。smoke-tester の ID トークンを発行し、IAP を通して
# 読み取りだけの Playwright のテスト（tests/e2e/dev/）を動かす。
# 使い方: scripts/dev-e2e.sh <dev の web の URL>
#   環境変数 SMOKE_TESTER_SA と IAP_CLIENT_ID が必要（scripts/smoke.sh と同じ）。Chromium を入れておくこと
set -euo pipefail

url="${1:?対象の URL を指定してください}"
: "${SMOKE_TESTER_SA:?SMOKE_TESTER_SA を設定してください}"
: "${IAP_CLIENT_ID:?IAP_CLIENT_ID を設定してください}"
root="$(cd "$(dirname "$0")/.." && pwd)"

token="$("$root/scripts/smoke-id-token.sh" "$SMOKE_TESTER_SA" "$IAP_CLIENT_ID")"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::$token"
fi
echo "dev での E2E: $url"
cd "$root"
DEV_BASE_URL="$url" DEV_ID_TOKEN="$token" pnpm exec playwright test -c playwright.dev.config.ts
