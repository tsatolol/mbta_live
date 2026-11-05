"use client";
// 共通のヘッダー（005 US1）: 1 行に、名前・DEV のバッジ・画面の切り替え・データの鮮度・表示の明るさの切り替え。
// 幅 768px 未満では、画面の切り替えと表示の切り替えをメニューに入れる（ヘッダーは 64px 以下・1 行）。
// データが古いとき（最後の成功から 3 分以上）は、ヘッダーの下に縞の帯を出す（002 FR-006、005 FR-004）
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useNow } from "@/hooks/use-now";
import { healthResponseSchema } from "@/lib/api-schemas/health";
import { freshnessState, staleMessage } from "@/lib/display/freshness";
import { cn } from "@/lib/utils";
import { Freshness } from "./freshness";
import { MobileMenu } from "./mobile-menu";
import { StaleBanner } from "./stale-banner";
import { ThemeToggle } from "./theme-toggle";

const NAV_ITEMS = [
  { href: "/", label: "Map" },
  { href: "/stations", label: "Stations" },
  { href: "/alerts", label: "Alerts" },
  { href: "/analytics", label: "Analytics" },
  { href: "/status", label: "Status" },
] as const;

/** 最終更新と stale の判定に使う。収集は prod で 1 分間隔なので 30 秒ごとに取り直す */
const HEALTH_REFETCH_MS = 30_000;

async function fetchHealth() {
  const res = await fetch("/api/health", { cache: "no-store" });
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}

export function Header({ appEnv }: { appEnv: string }) {
  const pathname = usePathname();
  const now = useNow(5_000);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFETCH_MS,
  });
  const lastCollectedAt = health.data?.lastCollectedAt
    ? new Date(health.data.lastCollectedAt)
    : null;
  const stale = health.isSuccess && freshnessState(lastCollectedAt, now) !== "live";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="relative border-b border-rule bg-panel">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 md:gap-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-md font-extrabold tracking-tight text-ink"
        >
          MBTA Live
          {appEnv === "dev" && (
            <span
              data-testid="env-badge"
              className="rounded-[4px] border border-ink px-1.5 text-xs font-semibold leading-5"
            >
              DEV
            </span>
          )}
        </Link>
        <nav aria-label="Main" className="hidden h-full md:flex md:gap-5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 今の画面: 太字 + 下の帯（色以外でも分かる）
                  "flex h-full items-center border-b-[3px] pt-[3px] text-sm",
                  active
                    ? "border-ink font-semibold text-ink"
                    : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <Freshness lastCollectedAt={lastCollectedAt} status={health.status} />
          <ThemeToggle className="hidden md:inline-flex" />
          <MobileMenu items={NAV_ITEMS} isActive={isActive} />
        </div>
      </div>
      {stale && <StaleBanner message={staleMessage(lastCollectedAt, now)} />}
    </header>
  );
}
