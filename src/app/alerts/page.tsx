"use client";
// アラートの画面（Alerts、US3）: 有効なアラートを路線ごとに重要度の高い順で、予告は別の区画に出す。
// 過去のアラートは期間・路線・影響の種類で検索する（FR-005）
import { useQuery } from "@tanstack/react-query";
import { alertsResponseSchema } from "@/lib/api-schemas/alerts";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { AlertGroups } from "@/components/alerts/alert-groups";
import { AlertSearch } from "@/components/alerts/alert-search";

/** 有効なアラートの取得間隔。収集は prod で 1 分間隔 */
const ALERTS_REFETCH_MS = 60_000;

export default function AlertsPage() {
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const active = useQuery({
    queryKey: ["live", "alerts", "active"],
    queryFn: () =>
      fetchJson("/api/live/alerts?status=active", (b) => alertsResponseSchema.parse(b)),
    refetchInterval: ALERTS_REFETCH_MS,
  });
  const upcoming = useQuery({
    queryKey: ["live", "alerts", "upcoming"],
    queryFn: () =>
      fetchJson("/api/live/alerts?status=upcoming", (b) => alertsResponseSchema.parse(b)),
    refetchInterval: ALERTS_REFETCH_MS,
  });
  const routeList = routes.data?.routes ?? [];
  const loading = <p className="text-sm text-muted-foreground">Loading alerts…</p>;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-lg font-extrabold">Alerts</h1>
      {(routes.isError || active.isError || upcoming.isError) && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load alerts. Retrying…
        </p>
      )}

      <section aria-labelledby="active-heading" data-testid="active-alerts">
        <h2 id="active-heading" className="mb-3 text-lg font-semibold">
          Active now
          {active.data && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {active.data.alerts.length}
            </span>
          )}
        </h2>
        {active.data && routes.data ? (
          <AlertGroups alerts={active.data.alerts} routes={routeList} empty="No active alerts." />
        ) : (
          loading
        )}
      </section>

      <section aria-labelledby="upcoming-heading" data-testid="upcoming-alerts">
        <h2 id="upcoming-heading" className="mb-3 text-lg font-semibold">
          Upcoming
          {upcoming.data && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {upcoming.data.alerts.length}
            </span>
          )}
        </h2>
        {upcoming.data && routes.data ? (
          <AlertGroups
            alerts={upcoming.data.alerts}
            routes={routeList}
            empty="No upcoming alerts."
          />
        ) : (
          loading
        )}
      </section>

      <section aria-labelledby="search-heading" data-testid="alert-search">
        <h2 id="search-heading" className="mb-3 text-lg font-semibold">
          Search past alerts
        </h2>
        <AlertSearch routes={routeList} />
      </section>
    </div>
  );
}
