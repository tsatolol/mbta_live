"use client";
// データの鮮度（005 US1、FR-003）: 点 + 「Updated 12 s ago」を毎秒更新する。
// 押すかフォーカスすると、正確な時刻（ボストン時間）が出る。スマホでは短い形（「12 s」）
import { useId, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { WarningIcon } from "@/components/icons";
import { freshnessLabel, freshnessState } from "@/lib/display/freshness";
import { formatInBoston } from "@/lib/time";

export function Freshness({
  lastCollectedAt,
  status,
}: {
  lastCollectedAt: Date | null;
  /** /api/health の取得の状態 */
  status: "pending" | "error" | "success";
}) {
  const now = useNow(1_000);
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const state = freshnessState(lastCollectedAt, now);

  if (status === "pending") {
    return (
      <span className="text-xs text-ink-muted" data-testid="last-updated">
        Loading…
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-danger"
        data-testid="last-updated"
      >
        <WarningIcon size={16} />
        Can’t reach the server
      </span>
    );
  }

  const label = freshnessLabel(lastCollectedAt, now);
  const compact = freshnessLabel(lastCollectedAt, now, { compact: true });
  return (
    <span className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-ink-muted hover:text-ink"
      >
        {state === "live" ? (
          // 正常: 塗りつぶした点。古いとき: 警告のアイコン（色だけで区別しない）
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-ink" />
        ) : (
          <WarningIcon size={16} className="text-ink" />
        )}
        <span data-testid="last-updated" className="tabular">
          <span className="hidden md:inline">Updated {label}</span>
          <span className="md:hidden">{compact}</span>
        </span>
      </button>
      <span
        id={detailId}
        role="status"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-max rounded-md border border-rule bg-panel px-3 py-2 text-xs text-ink"
      >
        {lastCollectedAt
          ? `Last successful collection: ${formatInBoston(lastCollectedAt, "MMM d, h:mm:ss a")} ET`
          : "No collection has succeeded yet"}
      </span>
    </span>
  );
}
