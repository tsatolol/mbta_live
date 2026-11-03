#!/usr/bin/env bash
# terraform plan の要約を Markdown で出力する（004 T028）。件数と、変更のあるリソースのアドレスと操作だけを出し、
# 値は出さない（public リポジトリのジョブサマリーに秘密の値を出さないため）。
#
# 使い方: scripts/plan-summary.sh <terraform show -json の出力ファイル>
set -euo pipefail

plan_json="${1:?terraform show -json の出力ファイルを指定してください}"

jq -r '
  def kind:
    if . == ["create"] then "追加"
    elif . == ["update"] then "変更"
    elif . == ["delete"] then "削除"
    elif (. == ["delete", "create"] or . == ["create", "delete"]) then "作り直し"
    elif . == ["read"] then "読み取り"
    else (. | join("/")) end;
  [(.resource_changes // [])[] | select(.change.actions != ["no-op"])] as $changes
  | if ($changes | length) == 0 then
      "変更なし"
    else
      ( "追加 \([$changes[] | select(.change.actions == ["create"])] | length) / "
      + "変更 \([$changes[] | select(.change.actions == ["update"])] | length) / "
      + "削除 \([$changes[] | select(.change.actions == ["delete"])] | length) / "
      + "作り直し \([$changes[] | select(.change.actions | length == 2)] | length)\n\n"
      + ([$changes[] | "- \(.change.actions | kind): `\(.address)`"] | join("\n")) )
    end
' "$plan_json"
