"use client";
// 共通のヘッダー: ナビゲーション、最終更新時刻（ボストン時間）、stale のバナー（FR-006）、環境バッジ
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useNow } from "@/hooks/use-now";
import { healthResponseSchema } from "@/lib/api-schemas/health";
import { isLiveDataStale } from "@/lib/metrics/live";
import { formatInBoston } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Map" },
  { href: "/stations", label: "Stations" },
  { href: "/alerts", label: "Alerts" },
  { href: "/status", label: "Status" },
] as const;

/** ヘッダーの最終更新時刻と stale の判定に使う。収集は prod で 1 分間隔なので 30 秒ごとに取り直す */
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
  const stale = health.isSuccess && isLiveDataStale(lastCollectedAt, now);

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          MBTA Live
          {appEnv === "dev" && (
            <Badge variant="warning" data-testid="env-badge">
              DEV
            </Badge>
          )}
        </Link>
        <nav className="flex gap-4 text-sm">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "hover:text-foreground",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <p className="ml-auto text-sm text-muted-foreground" data-testid="last-updated">
          {health.isError
            ? "Unable to reach the server"
            : lastCollectedAt
              ? `Last updated ${formatInBoston(lastCollectedAt, "h:mm:ss a")} ET`
              : health.isSuccess
                ? "No data collected yet"
                : "Loading…"}
        </p>
      </div>
      {stale && (
        <div
          role="alert"
          data-testid="stale-banner"
          className="bg-warning px-4 py-2 text-center text-sm text-warning-foreground"
        >
          Live data is stale. The last successful collection was{" "}
          {lastCollectedAt ? `at ${formatInBoston(lastCollectedAt, "h:mm a")} ET` : "never"}.
        </div>
      )}
    </header>
  );
}
