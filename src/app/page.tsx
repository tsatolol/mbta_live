"use client";
// 地図の画面（Live Map、US1）: 路線フィルタ、15 秒ごとの車両の取得、運行時間外の表示
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { vehiclesResponseSchema } from "@/lib/api-schemas/vehicles";
import { fetchJson } from "@/lib/fetch-json";
import { WarningIcon } from "@/components/icons";
import { LineLegend } from "@/components/map/line-legend";
import { lineCounts } from "@/lib/display/line-counts";

// MapLibre はブラウザでだけ動くので、サーバーでは描画しない
const LiveMap = dynamic(() => import("@/components/map/live-map"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading map…</p>,
});

/** 車両の取得間隔（FR-001）。収集は prod で 1 分間隔 */
const VEHICLES_REFETCH_MS = 15_000;

export default function LiveMapPage() {
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const vehicles = useQuery({
    queryKey: ["live", "vehicles"],
    queryFn: () => fetchJson("/api/live/vehicles", (b) => vehiclesResponseSchema.parse(b)),
    refetchInterval: VEHICLES_REFETCH_MS,
  });

  // 表示しない路線（初めはすべて表示）
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const routeList = useMemo(() => routes.data?.routes ?? [], [routes.data]);
  const selectedRouteIds = useMemo(
    () => routeList.map((r) => r.id).filter((id) => !hidden.has(id)),
    [routeList, hidden],
  );
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const vehicleList = vehicles.data?.vehicles ?? [];
  const counts = lineCounts(routeList, vehicleList);

  return (
    <div className="map-page flex min-h-0 flex-1 flex-col md:flex-row">
      <LineLegend
        routes={routeList}
        counts={counts}
        hidden={hidden}
        onToggle={toggle}
        ready={vehicles.isSuccess}
      />
      <section
        className="relative order-first min-h-0 min-w-0 flex-1 md:order-none"
        aria-label="Live train map"
      >
        {vehicles.isSuccess && vehicleList.length === 0 && (
          <p
            className="absolute inset-x-4 top-4 z-10 border border-rule bg-panel p-3 text-sm"
            data-testid="out-of-service"
            role="status"
          >
            No trains are running right now. Service is outside operating hours.
          </p>
        )}
        {(routes.isError || vehicles.isError) && (
          <p
            className="absolute inset-x-4 top-4 z-10 border border-rule bg-panel p-3 text-sm text-danger"
            role="alert"
          >
            <WarningIcon className="mr-2 inline-block" />
            Unable to load live data. Retrying automatically.
          </p>
        )}
        {routes.isPending && (
          <p className="p-4 text-sm text-ink-muted" role="status">
            Loading routes…
          </p>
        )}
        {routes.data && (
          <LiveMap
            routes={routes.data}
            vehicles={vehicleList}
            selectedRouteIds={selectedRouteIds}
          />
        )}
      </section>
    </div>
  );
}
