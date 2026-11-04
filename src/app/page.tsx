"use client";
// 地図の画面（Live Map、US1）: 路線フィルタ、15 秒ごとの車両の取得、運行時間外の表示
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { vehiclesResponseSchema } from "@/lib/api-schemas/vehicles";
import { cn } from "@/lib/utils";

// MapLibre はブラウザでだけ動くので、サーバーでは描画しない
const LiveMap = dynamic(() => import("@/components/map/live-map"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-muted-foreground">Loading map…</p>,
});

/** 車両の取得間隔（FR-001）。収集は prod で 1 分間隔 */
const VEHICLES_REFETCH_MS = 15_000;

async function fetchJson<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return parse(await res.json());
}

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
  const visibleCount = vehicleList.filter((v) => !hidden.has(v.routeId)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Route filter">
        {routeList.map((r) => {
          const on = !hidden.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id)}
              aria-pressed={on}
              data-testid={`route-filter-${r.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                on ? "text-white" : "bg-background text-muted-foreground",
              )}
              style={
                on ? { backgroundColor: `#${r.color}`, borderColor: `#${r.color}` } : undefined
              }
            >
              {r.longName}
            </button>
          );
        })}
        {vehicles.isSuccess && (
          <span className="ml-auto text-xs text-muted-foreground" data-testid="vehicle-count">
            {visibleCount} trains
          </span>
        )}
      </div>

      {vehicles.isSuccess && vehicleList.length === 0 && (
        <p
          className="rounded-md border bg-muted px-3 py-2 text-sm"
          data-testid="out-of-service"
          role="status"
        >
          No trains are running right now. Service is outside operating hours.
        </p>
      )}
      {(routes.isError || vehicles.isError) && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load live data. Retrying…
        </p>
      )}

      <div className="h-[70vh] min-h-[400px] overflow-hidden rounded-lg border">
        {routes.data && (
          <LiveMap
            routes={routes.data}
            vehicles={vehicleList}
            selectedRouteIds={selectedRouteIds}
          />
        )}
      </div>
    </div>
  );
}
