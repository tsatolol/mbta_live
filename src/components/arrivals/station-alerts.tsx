// 駅のアラート。重要度は色に加えて縞・アイコン・文言で示す（005 US3）。
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { InfoIcon, WarningIcon } from "@/components/icons";
import { effectLabel } from "@/components/alerts/format";
import { alertCategoryOf } from "@/lib/metrics/alert-stats";
import { lineColorToken } from "@/lib/display/line-counts";
import { arrivalRouteLabel } from "./format";

export function StationAlerts({ alerts }: { alerts: readonly AlertItem[] }) {
  if (alerts.length === 0) return null;
  return (
    <section
      aria-label="Service alerts"
      className="flex flex-col gap-3"
      data-testid="station-alerts"
    >
      {alerts.map((alert) => {
        const disruption = alertCategoryOf(alert.effect) === "disruption";
        const Icon = disruption ? WarningIcon : InfoIcon;
        return (
          <article
            key={alert.id}
            className="flex gap-3 border-y border-rule bg-panel p-3 text-sm"
            data-testid="station-alert"
            data-alert-id={alert.id}
          >
            {disruption && <span aria-hidden="true" className="stale-stripes w-3 shrink-0" />}
            <Icon className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{disruption ? "Disruption" : "Notice"}</span>
                <span className="text-xs text-ink-muted">{effectLabel(alert.effect)}</span>
                {alert.routeIds.map((routeId) => (
                  <span
                    key={routeId}
                    className="inline-flex items-center gap-2 text-xs text-ink-muted"
                  >
                    <span
                      aria-hidden="true"
                      className="h-4 w-1.5"
                      style={{ backgroundColor: `var(${lineColorToken(routeId)})` }}
                    />
                    {arrivalRouteLabel(routeId)}
                  </span>
                ))}
              </div>
              <p className="[overflow-wrap:anywhere]">{alert.header}</p>
            </div>
          </article>
        );
      })}
    </section>
  );
}
