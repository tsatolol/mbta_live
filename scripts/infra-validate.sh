#!/usr/bin/env bash
# Terraform の各ディレクトリで init（backend なし）と validate を実行する（pnpm infra:validate）。
# init が作るロックファイルや .terraform/ をリポジトリに残さないよう、infra/terraform を一時ディレクトリにコピーして実行する。
# プロバイダをローカルのミラーから読む場合は TF_CLI_CONFIG_FILE を設定しておく。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$root/infra/terraform" "$work/terraform"

status=0
for dir in bootstrap modules/app envs/dev envs/prod; do
  echo "== $dir"
  if ! (cd "$work/terraform/$dir" && terraform init -backend=false -input=false -no-color >/dev/null && terraform validate -no-color); then
    status=1
  fi
done
exit "$status"
