"use client";
import { useState } from "react";
import type { RouteInfo } from "@/lib/api-schemas/routes";
import { lineColorToken, lineCounts } from "@/lib/display/line-counts";
import { cn } from "@/lib/utils";

export function LineLegend({
  routes,
  counts,
  hidden,
  onToggle,
  ready,
}: {
  routes: readonly RouteInfo[];
  counts: ReturnType<typeof lineCounts>;
  hidden: ReadonlySet<string>;
  onToggle: (id: string) => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  // 合計は従来どおり、現在表示している列車数。
  const visible = counts.lines.reduce(
    (sum, line) => sum + (hidden.has(line.id) ? 0 : line.count),
    0,
  );
  return (
    <aside
      className="line-legend shrink-0 border-rule bg-panel md:w-60 md:border-r"
      aria-label="Lines"
    >
      <div className="flex items-center justify-between gap-3 p-3 md:p-4">
        <h1 className="hidden text-md font-extrabold md:block">Lines</h1>
        <button
          type="button"
          className="flex min-h-8 items-center gap-2 font-semibold md:hidden"
          aria-expanded={open}
          aria-controls="line-legend-routes"
          onClick={() => setOpen(!open)}
        >
          Lines <span aria-hidden="true">{open ? "▾" : "▴"}</span>
        </button>
        <span
          className="tabular-nums text-xs text-ink-muted"
          data-testid={ready ? "vehicle-count" : undefined}
        >
          {ready ? `${visible} trains` : "Loading…"}
        </span>
      </div>
      <div
        id="line-legend-routes"
        role="group"
        aria-label="Route filter"
        className={cn(
          "max-h-[50dvh] overflow-y-auto px-3 pb-3 md:block md:max-h-none md:px-4",
          !open && "hidden",
        )}
      >
        {counts.lines.map(({ id, count }) => {
          const route = routes.find((r) => r.id === id);
          const on = !hidden.has(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onToggle(id)}
              aria-pressed={on}
              data-testid={`route-filter-${id}`}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 px-2 py-2 text-left hover:bg-panel-muted",
                !on && "text-ink-muted",
              )}
            >
              <span
                aria-hidden="true"
                className="h-8 w-[6px] shrink-0 border-2"
                style={{
                  borderColor: `var(${lineColorToken(id)})`,
                  backgroundColor: on ? `var(${lineColorToken(id)})` : "transparent",
                }}
              />
              <span className="flex-1 text-md font-semibold">{route?.longName ?? id}</span>
              <span data-testid={`line-count-${id}`} className="tabular-nums">
                {ready ? count : "–"}
              </span>
              <span className="sr-only">{on ? "shown" : "hidden"}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
