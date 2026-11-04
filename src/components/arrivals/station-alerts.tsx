// 駅の到着表示に出す、その駅と路線に有効なアラート
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { Badge } from "@/components/ui/badge";
import { effectLabel } from "@/components/alerts/format";

export function StationAlerts({ alerts }: { alerts: readonly AlertItem[] }) {
  if (alerts.length === 0) return null;
  return (
    <section
      aria-label="Service alerts"
      className="flex flex-col gap-2"
      data-testid="station-alerts"
    >
      {alerts.map((a) => (
        <article
          key={a.id}
          className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm"
          data-testid="station-alert"
          data-alert-id={a.id}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="warning">{effectLabel(a.effect)}</Badge>
            <span className="text-xs text-muted-foreground">{a.routeIds.join(", ")}</span>
          </div>
          <p>{a.header}</p>
        </article>
      ))}
    </section>
  );
}
