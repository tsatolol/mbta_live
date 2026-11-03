#!/usr/bin/env bash
# terraform plan の変更内容のハッシュを出力する（004 T027）。
# ci で作った prod の plan と、承認後に cd-prod で作り直した plan のハッシュを比べ、
# 承認者が見た変更と違うものを prod に適用しないようにする（FR-007）。
#
# 使い方: scripts/plan-hash.sh <terraform show -json の出力ファイル>
# 比べるのは resource_changes のうち変更のあるもの（no-op 以外）の、アドレス・操作・変更前後の値・未確定の値。
# ファイルの中の秘密の値は出力しない（ハッシュだけを出す）
set -euo pipefail

plan_json="${1:?terraform show -json の出力ファイルを指定してください}"

normalized="$(jq -S '
  [(.resource_changes // [])[]
    | select(.change.actions != ["no-op"])
    | {
        address,
        actions: .change.actions,
        before: .change.before,
        after: .change.after,
        after_unknown: .change.after_unknown
      }]
  | sort_by(.address)
' "$plan_json")"
printf '%s' "$normalized" | sha256sum | cut -d' ' -f1
