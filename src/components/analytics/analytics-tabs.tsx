"use client";
// 分析の 4 つの画面のタブ。期間と路線の絞り込みは、タブを移っても引き継ぐ
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/analytics/headways", label: "Headways" },
  { href: "/analytics/predictions", label: "Prediction accuracy" },
  { href: "/analytics/alerts", label: "Alert trends" },
  { href: "/analytics/patterns", label: "Patterns" },
] as const;

/** タブを移るときに引き継ぐ絞り込み */
const SHARED_KEYS = ["from", "to", "route"] as const;

export function AnalyticsTabs() {
  const pathname = usePathname();
  const params = useSearchParams();
  const shared = new URLSearchParams();
  for (const key of SHARED_KEYS) {
    const value = params.get(key);
    if (value) shared.set(key, value);
  }
  const qs = shared.toString();
  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label="Analytics views">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={qs ? `${tab.href}?${qs}` : tab.href}
            aria-current={active ? "page" : undefined}
            data-testid={`analytics-tab-${tab.href.split("/").pop()}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
