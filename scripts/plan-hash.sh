#!/usr/bin/env bash
# terraform plan の変更内容のハッシュを出力する（004 T027）。
# ci で作った prod の plan と、承認後に cd-prod で作り直した plan のハッシュを比べ、
# 承認者が見た変更と違うものを prod に適用しないようにする（FR-007）。
#
# 使い方: scripts/plan-hash.sh <terraform show -json の出力ファイル>
# 比べるのは resource_changes のうち変更のあるもの（no-op 以外）の、アドレス・操作と、属性の差分だけ。
# 差分は、before と after で値が違う属性（変更前後の値）と、apply 後に決まる属性（値ではなく「未確定」という事実）。
# before 全体は比べない: before は refresh した state なので、変更と関係のない属性も時間で変わる
# （例: 毎分実行される collector の Cloud Run Job の latest_created_execution）。削除は値を比べない。
# ファイルの中の秘密の値は出力しない（ハッシュだけを出す）
set -euo pipefail

plan_json="${1:?terraform show -json の出力ファイルを指定してください}"

normalized="$(jq -S '
  # 属性の差分。差がなければ null
  def diff($b; $a; $u):
    if $u == true then
      {unknown: true}
    elif (($b | type) == "object" or ($a | type) == "object")
      and (($b | type) == "object" or $b == null)
      and (($a | type) == "object" or $a == null) then
      ($b // {}) as $bo | ($a // {}) as $ao
      | (if ($u | type) == "object" then $u else {} end) as $uo
      | reduce ([$bo, $ao, $uo] | map(keys[]) | unique)[] as $k ({};
          diff($bo[$k]; $ao[$k]; $uo[$k]) as $d
          | if $d == null then . else .[$k] = $d end)
      | if . == {} then null else . end
    elif ($b | type) == "array" and ($a | type) == "array" and ($b | length) == ($a | length) then
      (if ($u | type) == "array" then $u else [] end) as $ua
      | [range(0; $a | length) as $i | diff($b[$i]; $a[$i]; $ua[$i])]
      | if all(. == null) then null else . end
    elif $b == $a and ([$u | .. | select(. == true)] | length) == 0 then
      null
    else
      {before: $b, after: $a, after_unknown: $u}
    end;
  [(.resource_changes // [])[]
    | select(.change.actions != ["no-op"])
    | {
        address,
        actions: .change.actions,
        diff: (if .change.actions == ["delete"] then null
               else diff(.change.before; .change.after; .change.after_unknown) end)
      }]
  | sort_by(.address)
' "$plan_json")"
printf '%s' "$normalized" | sha256sum | cut -d' ' -f1
