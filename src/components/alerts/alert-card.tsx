// アラート1件: 分類を縞・アイコン・文言で示し、細い線で区切る。期間と詳細の開閉は保つ。
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { InfoIcon, WarningIcon } from "@/components/icons";
import { alertCategoryOf } from "@/lib/metrics/alert-stats";
import { lineColorToken } from "@/lib/display/line-counts";
import { arrivalRouteLabel } from "@/components/arrivals/format";
import { effectLabel, periodLabel } from "./format";

const STATUS_LABEL = { active: "Active", upcoming: "Upcoming", past: "Past" } as const;

export function AlertCard({
  alert,
  showStatus = false,
}: {
  alert: AlertItem;
  showStatus?: boolean;
}) {
  const disruption = alertCategoryOf(alert.effect) === "disruption";
  const Icon = disruption ? WarningIcon : InfoIcon;
  return (
    <article
      className="flex gap-3 border-t border-rule py-4 text-sm"
      data-category={disruption ? "disruption" : "notice"}
      data-testid="alert-card"
      data-alert-id={alert.id}
      data-status={alert.status}
    >
      {disruption && <span aria-hidden="true" className="stale-stripes w-3 shrink-0" />}
      <Icon className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{disruption ? "Disruption" : "Notice"}</span>
          <span className="text-xs text-ink-muted" data-testid="alert-effect">
            {effectLabel(alert.effect)}
          </span>
          {showStatus && (
            <span className="text-xs text-ink-muted" data-testid="alert-status">
              {STATUS_LABEL[alert.status]}
            </span>
          )}
          <span className="text-xs text-ink-muted">Severity {alert.severity}</span>
          {alert.routeIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-2 text-xs text-ink-muted">
              <span
                aria-hidden="true"
                className="h-4 w-1.5 shrink-0"
                style={{ backgroundColor: `var(${lineColorToken(id)})` }}
              />
              {arrivalRouteLabel(id)}
            </span>
          ))}
        </div>
        <p className="font-medium">{alert.header}</p>
        {alert.activePeriod.length > 0 && (
          <ul className="mt-1 text-xs text-muted-foreground">
            {alert.activePeriod.slice(0, 3).map((p) => (
              <li key={p.start}>{periodLabel(p)}</li>
            ))}
            {alert.activePeriod.length > 3 && (
              <li>and {alert.activePeriod.length - 3} more periods</li>
            )}
          </ul>
        )}
        {alert.description && (
          <details className="mt-1">
            <summary className="min-h-6 cursor-pointer text-xs text-ink-muted">Details</summary>
            <p className="mt-1 whitespace-pre-line">{alert.description}</p>
          </details>
        )}
      </div>
    </article>
  );
}
