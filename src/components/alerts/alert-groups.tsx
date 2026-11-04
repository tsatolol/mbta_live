// アラートを路線（の組み合わせ）ごとにまとめて出す
import type { AlertItem } from "@/lib/api-schemas/alerts";
import type { RouteInfo } from "@/lib/api-schemas/routes";
import { AlertCard } from "./alert-card";
import { groupAlertsByRoutes } from "./format";

export function AlertGroups({
  alerts,
  routes,
  empty,
}: {
  alerts: readonly AlertItem[];
  routes: readonly RouteInfo[];
  empty: string;
}) {
  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const byId = new Map(routes.map((r) => [r.id, r]));
  const groups = groupAlertsByRoutes(
    alerts,
    routes.map((r) => r.id),
  );
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const key = g.routeIds.join(",") || "none";
        return (
          <section key={key} data-testid="alert-group" data-routes={key}>
            <h3 className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold">
              {g.routeIds.length === 0 && "Other"}
              {g.routeIds.map((id) => (
                <span key={id} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: `#${byId.get(id)?.color ?? "888888"}` }}
                  />
                  {byId.get(id)?.longName ?? id}
                </span>
              ))}
            </h3>
            <div className="flex flex-col gap-2">
              {g.alerts.map((a) => (
                <AlertCard key={a.id} alert={a} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
