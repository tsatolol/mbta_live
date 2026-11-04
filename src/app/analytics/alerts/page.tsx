"use client";
// アラートの傾向の画面（003 US3）: 路線・期間で絞り込み、遅延系とお知らせ系を分けて、日別の時間と件数、
// effect ごと・cause ごとの内訳を出す
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { alertsAnalyticsResponseSchema } from "@/lib/api-schemas/analytics-alerts";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { effectLabel } from "@/components/alerts/format";
import { EChart } from "@/components/charts/echart";
import {
  alertCountByDayOption,
  alertHoursByDayOption,
  alertHoursByEffectOption,
  CATEGORY_LABELS,
  minutesToHours,
} from "@/components/analytics/alert-charts";
import { AggregationNote } from "@/components/analytics/analytics-notes";
import { FilterBar } from "@/components/analytics/filter-bar";
import { ChartSection, StatTile } from "@/components/analytics/stat-tile";
import { useAnalyticsFilters } from "@/components/analytics/use-analytics-filters";

export default function AlertTrendsPage() {
  const { filters, setFilters, query } = useAnalyticsFilters();
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  // Green（合算）は運行間隔だけ。ほかのタブから引き継いだら、すべての路線として扱う
  const route = filters.route === "Green" ? undefined : filters.route;
  const qs = new URLSearchParams(query(["from", "to"]));
  if (route) qs.set("route", route);
  const qsString = qs.toString();
  const data = useQuery({
    queryKey: ["analytics", "alerts", qsString],
    queryFn: () =>
      fetchJson(`/api/analytics/alerts?${qsString}`, (b) => alertsAnalyticsResponseSchema.parse(b)),
  });
  const res = data.data;

  const hours = useMemo(() => (res ? alertHoursByDayOption(res) : null), [res]);
  const counts = useMemo(() => (res ? alertCountByDayOption(res) : null), [res]);
  const byEffect = useMemo(() => (res ? alertHoursByEffectOption(res) : null), [res]);
  const empty = res && res.byEffect.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filters={{ ...filters, route }}
        setFilters={setFilters}
        resolved={res}
        routes={routes.data?.routes ?? []}
        showDirection={false}
      />

      {data.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load alert trends. Check the filters and try again.
        </p>
      )}
      {data.isPending && <p className="text-sm text-muted-foreground">Loading alert trends…</p>}

      {res && (
        <>
          <AggregationNote meta={res} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              testId="stat-disruption-alerts"
              label="Disruption alerts"
              value={res.totals.disruption.alertCount.toLocaleString("en-US")}
              hint="Delays, suspensions, shuttles, station closures (alert-days)"
            />
            <StatTile
              testId="stat-disruption-hours"
              label="Disruption hours"
              value={minutesToHours(res.totals.disruption.activeMinutes).toLocaleString("en-US")}
            />
            <StatTile
              testId="stat-notice-alerts"
              label="Notices"
              value={res.totals.notice.alertCount.toLocaleString("en-US")}
              hint="Station issues and other notices (alert-days)"
            />
            <StatTile
              testId="stat-notice-hours"
              label="Notice hours"
              value={minutesToHours(res.totals.notice.activeMinutes).toLocaleString("en-US")}
            />
          </div>

          {empty ? (
            <p className="text-sm text-muted-foreground" data-testid="analytics-empty">
              No alerts were active for this selection.
            </p>
          ) : (
            <>
              <ChartSection
                title="Alert hours by service date"
                description="Total time each alert was active and shown in the feed. Upcoming alerts that have not started are not counted."
              >
                {hours && (
                  <EChart id="alert-hours" option={hours} ariaLabel="Alert hours by service date" />
                )}
              </ChartSection>
              <ChartSection
                title="Alerts by service date (count)"
                description="An alert active on several days is counted once per day."
              >
                {counts && (
                  <EChart id="alert-counts" option={counts} ariaLabel="Alerts by service date" />
                )}
              </ChartSection>
              <ChartSection title="Alert hours by effect">
                {byEffect && (
                  <EChart id="alert-effects" option={byEffect} ariaLabel="Alert hours by effect" />
                )}
              </ChartSection>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show data tables</summary>
                <table
                  className="mt-2 w-full text-left text-xs tabular-nums"
                  data-testid="alert-effect-table"
                >
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Effect</th>
                      <th className="py-1 pr-3 font-medium">Type</th>
                      <th className="py-1 pr-3 font-medium">Alert-days</th>
                      <th className="py-1 pr-3 font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.byEffect.map((e) => (
                      <tr key={e.effect} className="border-t">
                        <td className="py-1 pr-3">{effectLabel(e.effect)}</td>
                        <td className="py-1 pr-3">{CATEGORY_LABELS[e.category]}</td>
                        <td className="py-1 pr-3">{e.alertCount}</td>
                        <td className="py-1 pr-3">{minutesToHours(e.activeMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table
                  className="mt-4 w-full text-left text-xs tabular-nums"
                  data-testid="alert-cause-table"
                >
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Cause</th>
                      <th className="py-1 pr-3 font-medium">Alert-days</th>
                      <th className="py-1 pr-3 font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.byCause.map((c) => (
                      <tr key={c.cause} className="border-t">
                        <td className="py-1 pr-3">{effectLabel(c.cause)}</td>
                        <td className="py-1 pr-3">{c.alertCount}</td>
                        <td className="py-1 pr-3">{minutesToHours(c.activeMinutes)}</td>
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
