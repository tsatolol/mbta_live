"use client";
// パターンの画面（003 US4）: 曜日 × 時間帯（ET）のヒートマップ。指標（運行間隔 p90・予測誤差・
// 遅延系のアラートの分数）と路線・期間を切り替える
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { heatmapResponseSchema } from "@/lib/api-schemas/analytics-heatmap";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { HEATMAP_DAYS_OF_WEEK, HEATMAP_METRICS, type HeatmapMetric } from "@/lib/metrics/heatmap";
import { SERVICE_DAY_HOURS } from "@/lib/time";
import { EChart } from "@/components/charts/echart";
import { hourLabel } from "@/components/charts/theme";
import { AggregationNote } from "@/components/analytics/analytics-notes";
import { FilterBar, FilterField, selectClass } from "@/components/analytics/filter-bar";
import {
  dayLabel,
  displayValue,
  heatmapOption,
  METRIC_INFO,
} from "@/components/analytics/heatmap-chart";
import { ChartSection } from "@/components/analytics/chart-section";
import { AnalyticsSummary } from "@/components/analytics/summary";
import { patternSummary } from "@/lib/display/summaries";
import { useAnalyticsFilters } from "@/components/analytics/use-analytics-filters";

function isMetric(value: string | undefined): value is HeatmapMetric {
  return (HEATMAP_METRICS as readonly string[]).includes(value ?? "");
}

export default function PatternsPage() {
  const { filters, setFilters, query } = useAnalyticsFilters();
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const metric: HeatmapMetric = isMetric(filters.metric) ? filters.metric : "headway_p90";
  // Green（合算）は運行間隔だけ。ほかの指標では、すべての路線として扱う
  const route = filters.route === "Green" && metric !== "headway_p90" ? undefined : filters.route;
  const qs = new URLSearchParams(query(["from", "to"]));
  qs.set("metric", metric);
  if (route) qs.set("route", route);
  const qsString = qs.toString();
  const data = useQuery({
    queryKey: ["analytics", "heatmap", qsString],
    queryFn: () =>
      fetchJson(`/api/analytics/heatmap?${qsString}`, (b) => heatmapResponseSchema.parse(b)),
  });
  const res = data.data;
  const option = useMemo(() => (res ? heatmapOption(res) : null), [res]);
  const info = METRIC_INFO[metric];
  const hasData = res?.cells.some((c) => c.value !== null) ?? false;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filters={{ ...filters, route }}
        setFilters={setFilters}
        resolved={res}
        routes={routes.data?.routes ?? []}
        includeGreen={metric === "headway_p90"}
        showDirection={false}
      >
        <FilterField label="Metric">
          <select
            className={selectClass}
            value={metric}
            onChange={(e) => setFilters({ metric: e.target.value })}
            data-testid="filter-metric"
          >
            {HEATMAP_METRICS.map((m) => (
              <option key={m} value={m}>
                {METRIC_INFO[m].label}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {data.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load the pattern. Check the filters and try again.
        </p>
      )}
      {data.isPending && <p className="text-sm text-muted-foreground">Loading pattern…</p>}

      {res && (
        <>
          <AggregationNote meta={res} />
          <AnalyticsSummary parts={patternSummary(res)} empty={!hasData} />
          {hasData && (
            <>
              <ChartSection
                title={`${info.label} by day of week and hour, Boston time (${info.unit})`}
                description={`${info.description} Days are service days (a service day runs from 3:00 to 2:59 the next morning). Empty cells have no data.`}
              >
                {option && (
                  <EChart
                    id="pattern-heatmap"
                    option={option}
                    height={300}
                    ariaLabel={`${info.label} by day of week and hour`}
                  />
                )}
              </ChartSection>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show data table</summary>
                <div
                  className="mt-2 overflow-x-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Pattern data table"
                >
                  <table className="text-left text-xs tabular-nums" data-testid="pattern-table">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Day</th>
                        {SERVICE_DAY_HOURS.map((h) => (
                          <th key={h} className="py-1 pr-2 font-medium">
                            {hourLabel(h)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {HEATMAP_DAYS_OF_WEEK.map((dow) => (
                        <tr key={dow} className="border-t">
                          <td className="py-1 pr-2 font-medium">{dayLabel(dow)}</td>
                          {SERVICE_DAY_HOURS.map((h) => {
                            const c = res.cells.find((x) => x.dayOfWeek === dow && x.hour === h);
                            return (
                              <td key={h} className="py-1 pr-2">
                                {c?.value == null ? "–" : displayValue(metric, c.value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}
