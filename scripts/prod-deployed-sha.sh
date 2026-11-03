#!/usr/bin/env bash
# prod で今動いているコミット（GitHub の Environment `prod` の最後に成功したデプロイ）の SHA を出力する。
# まだ prod にデプロイしていなければ何も出力しない。
# GitHub CLI（gh）を使う。GITHUB_TOKEN（deployments: read）と GITHUB_REPOSITORY が必要
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY を設定してください}"

# 新しい順に並ぶ。各デプロイの最新の状態が success のものを探す
for id in $(gh api "repos/$repo/deployments?environment=prod&per_page=30" --jq '.[].id'); do
  state="$(gh api "repos/$repo/deployments/$id/statuses?per_page=1" --jq '.[0].state // ""')"
  if [ "$state" = "success" ]; then
    gh api "repos/$repo/deployments/$id" --jq '.sha'
    exit 0
  fi
done
