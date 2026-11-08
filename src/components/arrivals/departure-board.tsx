// 005 US3: ホームの発車標。明暗どちらでも濃い板、残り時間は各便に 1 つだけ。
import type { DirectionGroup } from "@/lib/api-schemas/predictions";
import { formatInBoston } from "@/lib/time";
import { lineColorToken } from "@/lib/display/line-counts";
import {
  arrivalDirectionLabel,
  arrivalRouteLabel,
  countdownLabel,
  upcomingArrivals,
} from "./format";

export function DepartureBoard({
  directions,
  now,
  snapshotAt,
}: {
  directions: readonly DirectionGroup[];
  now: Date;
  snapshotAt: Date;
}) {
  return (
    <section
      aria-label="Departures"
      data-testid="departure-board"
      className="overflow-hidden rounded-[var(--radius-board)] border border-board-edge bg-board text-board-ink"
    >
      {directions.map((group) => {
        const arrivals = upcomingArrivals(group.arrivals, snapshotAt);
        return (
          <div
            key={`${group.routeId}-${group.directionId}`}
            data-testid={`direction-${group.routeId}-${group.directionId}`}
            className="relative border-b border-board-muted/30 py-6 pr-4 pl-6 last:border-b-0 sm:pr-6 sm:pl-8"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-6 left-0 w-[6px]"
              style={{ backgroundColor: `var(${lineColorToken(group.routeId)})` }}
            />
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="min-w-0 text-lg font-extrabold [overflow-wrap:anywhere]">
                {group.destination ?? "Unknown destination"}
              </h2>
              <p className="text-xs text-board-muted">
                {arrivalRouteLabel(group.routeId)}
                {group.directionName ? `, ${arrivalDirectionLabel(group.directionName)}` : ""}
              </p>
            </div>
            {arrivals.length === 0 ? (
              <p className="text-sm text-board-muted" data-testid="no-arrivals">
                No upcoming trains
              </p>
            ) : (
              <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-6 sm:grid-cols-3">
                {arrivals.map((arrival) => {
                  const at = new Date(arrival.time);
                  return (
                    <li
                      key={arrival.tripId}
                      className="flex min-w-0 flex-col items-start gap-3"
                      data-testid="arrival"
                      data-trip-id={arrival.tripId}
                      data-cancelled={String(arrival.cancelled)}
                    >
                      {arrival.cancelled ? (
                        <span data-testid="arrival-cancelled" className="text-sm font-semibold">
                          Cancelled
                        </span>
                      ) : (
                        <span
                          className="text-xl leading-none font-semibold whitespace-nowrap text-countdown tabular-nums md:text-2xl"
                          data-testid="arrival-countdown"
                        >
                          {countdownLabel(at, now)}
                        </span>
                      )}
                      <span className="text-xs text-board-muted tabular-nums">
                        {arrival.timeKind === "departure" && <span>departs </span>}
                        <time
                          dateTime={arrival.time}
                          className={arrival.cancelled ? "line-through" : undefined}
                        >
                          {formatInBoston(at, "h:mm a")}
                        </time>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </section>
  );
}
