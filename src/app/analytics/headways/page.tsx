"use client";
// 運行間隔の画面（003 US1）: 路線・方向・駅・期間で絞り込み、日別の推移、時間帯ごとの分布、
// 団子運転と間隔の開きの件数を出す
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { headwaysResponseSchema } from "@/lib/api-schemas/analytics-headways";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { EChart } from "@/components/charts/echart";
import { secToMin } from "@/components/charts/theme";
import { AggregationNote } from "@/components/analytics/analytics-notes";
import { FilterBar, FilterField, selectClass } from "@/components/analytics/filter-bar";
import {
  headwayByHourOption,
  headwayIncidentsOption,
  headwayTrendOption,
  overallMedianMin,
} from "@/components/analytics/headway-charts";
import { ChartSection, StatTile } from "@/components/analytics/stat-tile";
import { useAnalyticsFilters } from "@/components/analytics/use-analytics-filters";

export default function HeadwaysPage() {
  const { filters, setFilters, query } = useAnalyticsFilters();
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const qs = query(["from", "to", "route", "direction", "stop"]);
  const data = useQuery({
    queryKey: ["analytics", "headways", qs],
    queryFn: () =>
      fetchJson(`/api/analytics/headways?${qs}`, (b) => headwaysResponseSchema.parse(b)),
  });
  const res = data.data;

  const trend = useMemo(() => (res ? headwayTrendOption(res) : null), [res]);
  const byHour = useMemo(() => (res ? headwayByHourOption(res) : null), [res]);
  const incidents = useMemo(() => (res ? headwayIncidentsOption(res) : null), [res]);
  const median = res ? overallMedianMin(res) : null;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        resolved={res}
        routes={routes.data?.routes ?? []}
        includeGreen
        allowAllRoutes={false}
        defaultRoute="Red"
      >
        <FilterField label="Station">
          <select
            className={selectClass}
            value={filters.stop ?? ""}
            onChange={(e) => setFilters({ stop: e.target.value })}
            data-testid="filter-stop"
          >
            <option value="">All stations</option>
            {(res?.stops ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {data.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load headways. Check the filters and try again.
        </p>
      )}
      {data.isPending && <p className="text-sm text-muted-foreground">Loading headways…</p>}

      {res && (
        <>
          <AggregationNote meta={res} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              testId="stat-headways"
              label="Headways measured"
              value={res.totals.n.toLocaleString("en-US")}
            />
            <StatTile
              testId="stat-median"
              label="Typical headway"
              value={median === null ? "–" : `${median} min`}
              hint="Median, averaged over days and hours"
            />
            <StatTile
              testId="stat-bunching"
              label="Bunching"
              value={res.totals.bunchingCount.toLocaleString("en-US")}
              hint="Headways under 2 minutes"
            />
            <StatTile
              testId="stat-gaps"
              label="Gaps"
              value={res.totals.gapCount.toLocaleString("en-US")}
              hint="Over 2× the usual headway for that hour"
            />
          </div>

          {res.totals.n === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="analytics-empty">
              No headway data for this selection.
            </p>
          ) : (
            <>
              <ChartSection
                title="Headway by service date (minutes)"
                description="Daily values combine hours and stations, weighted by the number of headways (approximate percentiles)."
              >
                {trend && (
                  <EChart id="headway-trend" option={trend} ariaLabel="Headway by service date" />
                )}
              </ChartSection>
              <ChartSection title="Headway by hour of day, Boston time (minutes)">
                {byHour && (
                  <EChart id="headway-by-hour" option={byHour} ariaLabel="Headway by hour of day" />
                )}
              </ChartSection>
              <ChartSection
                title="Bunching and gaps by service date (count)"
                description="Gaps are counted only when the previous 28 days have data for the same day type and hour."
              >
                {incidents && (
                  <EChart
                    id="headway-incidents"
                    option={incidents}
                    ariaLabel="Bunching and gaps by service date"
                  />
                )}
              </ChartSection>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show data table</summary>
                <table
                  className="mt-2 w-full text-left text-xs tabular-nums"
                  data-testid="headway-table"
                >
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Service date</th>
                      <th className="py-1 pr-3 font-medium">Headways</th>
                      <th className="py-1 pr-3 font-medium">Median (min)</th>
                      <th className="py-1 pr-3 font-medium">p90 (min)</th>
                      <th className="py-1 pr-3 font-medium">Max (min)</th>
                      <th className="py-1 pr-3 font-medium">Bunching</th>
                      <th className="py-1 pr-3 font-medium">Gaps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.daily.map((d) => (
                      <tr key={d.serviceDate} className="border-t">
                        <td className="py-1 pr-3">{d.serviceDate}</td>
                        <td className="py-1 pr-3">{d.n}</td>
                        <td className="py-1 pr-3">{secToMin(d.p50Sec)}</td>
                        <td className="py-1 pr-3">{secToMin(d.p90Sec)}</td>
                        <td className="py-1 pr-3">{secToMin(d.maxSec)}</td>
                        <td className="py-1 pr-3">{d.bunchingCount}</td>
                        <td className="py-1 pr-3">{d.gapCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}
