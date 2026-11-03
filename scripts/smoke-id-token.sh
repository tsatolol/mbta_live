#!/usr/bin/env bash
# smoke-tester の ID トークンを発行して標準出力に出す（スモークテストで IAP を通るため）。
# 使い方: scripts/smoke-id-token.sh <smoke-tester の SA のメールアドレス> <audience（web の URL）>
#
# gcloud auth print-identity-token --impersonate-service-account は、ID トークンの前に smoke-tester の
# アクセストークンも取ろうとするので、Token Creator（getAccessToken）が要る。deployer に付けているのは
# ID トークンの発行（roles/iam.serviceAccountOpenIdTokenCreator）だけなので、IAM Credentials API の
# generateIdToken を直接呼ぶ。今の gcloud の認証（deployer）のアクセストークンを使う
set -euo pipefail

sa="${1:?smoke-tester の SA を指定してください}"
audience="${2:?audience を指定してください}"

access_token="$(gcloud auth print-access-token)"
if [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::add-mask::$access_token" >&2
fi

body="$(jq -n --arg audience "$audience" '{audience: $audience, includeEmail: true}')"
response="$(curl -sS --fail-with-body -X POST \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/json" \
  -d "$body" \
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/$sa:generateIdToken")" || {
  # 失敗したときの応答（エラーの内容）にはトークンは含まれない
  echo "$response" >&2
  exit 1
}
jq -er '.token' <<<"$response"
