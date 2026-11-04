// 1 つの路線・方向の次の列車（最大 3 本）。カウントダウンは親から渡す現在時刻で毎秒進む
import type { DirectionGroup } from "@/lib/api-schemas/predictions";
import { formatInBoston } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { countdownClock, countdownLabel } from "./format";

export function DirectionCard({ group, now }: { group: DirectionGroup; now: Date }) {
  // 取得のあとに時刻が過ぎた便は表示しない
  const arrivals = group.arrivals.flatMap((a) => {
    const time = new Date(a.time);
    const label = countdownLabel(time, now);
    return label === null ? [] : [{ ...a, at: time, label, clock: countdownClock(time, now) }];
  });
  const testId = `direction-${group.routeId}-${group.directionId}`;

  return (
    <section className="overflow-hidden rounded-lg border" data-testid={testId}>
      <h2
        className="flex items-baseline gap-2 px-3 py-2 text-sm font-semibold text-white"
        style={{ backgroundColor: `#${group.routeColor}` }}
      >
        <span>{group.destination ?? "Unknown destination"}</span>
        {group.directionName && (
          <span className="text-xs font-normal opacity-90">{group.directionName}bound</span>
        )}
        <span className="ml-auto text-xs font-normal opacity-90">{group.routeId}</span>
      </h2>
      {arrivals.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted-foreground" data-testid="no-arrivals">
          No upcoming trains
        </p>
      ) : (
        <ol className="divide-y">
          {arrivals.map((a) => (
            <li
              key={a.tripId}
              className="flex items-center gap-3 px-3 py-2 text-sm"
              data-testid="arrival"
              data-trip-id={a.tripId}
              data-cancelled={a.cancelled ? "true" : "false"}
            >
              <span className="w-16 text-muted-foreground">
                {a.timeKind === "departure" ? "Departs" : "Arrives"}
              </span>
              <span className="text-muted-foreground">{formatInBoston(a.at, "h:mm a")}</span>
              {a.cancelled ? (
                <Badge variant="destructive" className="ml-auto" data-testid="arrival-cancelled">
                  Cancelled
                </Badge>
              ) : (
                <span className="ml-auto flex items-baseline gap-2">
                  <span
                    className="text-xs text-muted-foreground tabular-nums"
                    aria-hidden
                    data-testid="arrival-clock"
                  >
                    {a.clock}
                  </span>
                  <span className="font-semibold tabular-nums" data-testid="arrival-countdown">
                    {a.label}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
