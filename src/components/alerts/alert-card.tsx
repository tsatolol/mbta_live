// アラート 1 件: 影響の種類（effect）のバッジ、重要度、見出し、有効な区間、詳細（開閉）
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { effectLabel, periodLabel } from "./format";

const STATUS_LABEL = { active: "Active", upcoming: "Upcoming", past: "Past" } as const;

export function AlertCard({
  alert,
  showStatus = false,
}: {
  alert: AlertItem;
  showStatus?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        alert.status === "active" && alert.severity >= 7 && "border-destructive/60",
      )}
      data-testid="alert-card"
      data-alert-id={alert.id}
      data-status={alert.status}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant={alert.severity >= 7 ? "destructive" : "warning"} data-testid="alert-effect">
          {effectLabel(alert.effect)}
        </Badge>
        {showStatus && (
          <Badge variant="outline" data-testid="alert-status">
            {STATUS_LABEL[alert.status]}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">Severity {alert.severity}</span>
        {showStatus && (
          <span className="text-xs text-muted-foreground">{alert.routeIds.join(", ")}</span>
        )}
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
          <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
          <p className="mt-1 whitespace-pre-line">{alert.description}</p>
        </details>
      )}
    </article>
  );
}
