// データが古いときの帯（005 US1、FR-004）: 斜めの縞（警戒の帯）+ 警告のアイコン + 文言。色だけに頼らない。
// 縞は文言のすぐ左に置く（本文の幅にそろえる）。出たときに縞を 1 回だけ流す（動きを減らす設定では止まる）
import { WarningIcon } from "@/components/icons";

export function StaleBanner({ message }: { message: string }) {
  return (
    <div role="alert" data-testid="stale-banner" className="border-t border-rule bg-panel">
      <div className="mx-auto flex max-w-6xl items-stretch gap-3 px-4">
        <span aria-hidden="true" className="stale-stripes w-6 shrink-0 md:w-10" />
        <p className="flex items-center gap-2 py-2 text-sm text-ink">
          <WarningIcon size={18} className="shrink-0" />
          {message}
        </p>
      </div>
    </div>
  );
}
