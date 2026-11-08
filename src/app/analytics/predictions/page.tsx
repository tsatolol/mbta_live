"use client";
// 予測精度の画面（003 US2）: 路線・方向・予測の種類・期間で絞り込み、リード時間ごとの誤差、
// ±60 秒以内の割合、日別の推移を出す
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { predictionsResponseSchema } from "@/lib/api-schemas/analytics-predictions";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { UPDATE_TYPES } from "@/lib/metrics/prediction-accuracy";
import { EChart } from "@/components/charts/echart";
import { AggregationNote } from "@/components/analytics/analytics-notes";
import { FilterBar, FilterField, selectClass } from "@/components/analytics/filter-bar";
import {
  biasLabel,
  errorByLeadOption,
  errorTrendOption,
  leadLabel,
  percent,
  updateTypeLabel,
  withinByLeadOption,
} from "@/components/analytics/prediction-charts";
import { ChartSection } from "@/components/analytics/chart-section";
import { AnalyticsSummary } from "@/components/analytics/summary";
import { predictionSummary } from "@/lib/display/summaries";
import { useAnalyticsFilters } from "@/components/analytics/use-analytics-filters";

export default function PredictionsPage() {
  const { filters, setFilters, query } = useAnalyticsFilters();
  const routes = useQuery({
    queryKey: ["static", "routes"],
    queryFn: () => fetchJson("/api/static/routes", (b) => routesResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  // Green（合算）は運行間隔だけ。ほかのタブから引き継いだら、すべての路線として扱う
  const route = filters.route === "Green" ? undefined : filters.route;
  const qs = new URLSearchParams(query(["from", "to", "direction", "updateType"]));
  if (route) qs.set("route", route);
  const qsString = qs.toString();
  const data = useQuery({
    queryKey: ["analytics", "predictions", qsString],
    queryFn: () =>
      fetchJson(`/api/analytics/predictions?${qsString}`, (b) =>
        predictionsResponseSchema.parse(b),
      ),
  });
  const res = data.data;

  const byLead = useMemo(() => (res ? errorByLeadOption(res) : null), [res]);
  const within = useMemo(() => (res ? withinByLeadOption(res) : null), [res]);
  const trend = useMemo(() => (res ? errorTrendOption(res) : null), [res]);
  const totals = res?.totals ?? null;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        filters={{ ...filters, route }}
        setFilters={setFilters}
        resolved={res}
        routes={routes.data?.routes ?? []}
      >
        <FilterField label="Prediction type">
          <select
            className={selectClass}
            value={filters.updateType ?? ""}
            onChange={(e) => setFilters({ updateType: e.target.value })}
            data-testid="filter-update-type"
          >
            <option value="">All types</option>
            {UPDATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {updateTypeLabel(t)}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {data.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load prediction accuracy. Check the filters and try again.
        </p>
      )}
      {data.isPending && (
        <p className="text-sm text-muted-foreground">Loading prediction accuracy…</p>
      )}

      {res && (
        <>
          <AggregationNote meta={res} />
          <AnalyticsSummary parts={predictionSummary(res)} empty={!totals} />

          {totals && (
            <>
              <ChartSection
                title="Error by lead time (seconds)"
                description="How far before the arrival the prediction was made. The 90th percentile is averaged over hours and days (approximate)."
              >
                {byLead && (
                  <EChart
                    id="prediction-error-by-lead"
                    option={byLead}
                    ariaLabel="Error by lead time"
                  />
                )}
              </ChartSection>
              <ChartSection title="Predictions within ±60 seconds by lead time (%)">
                {within && (
                  <EChart
                    id="prediction-within-by-lead"
                    option={within}
                    ariaLabel="Share of predictions within 60 seconds by lead time"
                  />
                )}
              </ChartSection>
              <ChartSection title="Mean absolute error by service date (seconds)">
                {trend && (
                  <EChart
                    id="prediction-trend"
                    option={trend}
                    ariaLabel="Mean absolute error by service date"
                  />
                )}
              </ChartSection>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Show data tables</summary>
                <div
                  className="overflow-x-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Prediction statistics by lead time"
                >
                  <table
                    className="mt-2 w-full text-left text-xs tabular-nums"
                    data-testid="prediction-lead-table"
                  >
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Lead time</th>
                        <th className="py-1 pr-3 font-medium">Predictions</th>
                        <th className="py-1 pr-3 font-medium">Bias</th>
                        <th className="py-1 pr-3 font-medium">Mean abs. error (s)</th>
                        <th className="py-1 pr-3 font-medium">p90 abs. error (s)</th>
                        <th className="py-1 pr-3 font-medium">Within ±60 s</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.byLead.map((l) => (
                        <tr key={l.leadBucketMin} className="border-t">
                          <td className="py-1 pr-3">{leadLabel(l.leadBucketMin)}</td>
                          <td className="py-1 pr-3">{l.n}</td>
                          <td className="py-1 pr-3">{biasLabel(l.meanErrorSec)}</td>
                          <td className="py-1 pr-3">{Math.round(l.meanAbsErrorSec)}</td>
                          <td className="py-1 pr-3">{Math.round(l.p90AbsErrorSec)}</td>
                          <td className="py-1 pr-3">{percent(l.within60sRatio)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div
                  className="overflow-x-auto"
                  tabIndex={0}
                  role="region"
                  aria-label="Prediction statistics by type"
                >
                  <table
                    className="mt-4 w-full text-left text-xs tabular-nums"
                    data-testid="prediction-type-table"
                  >
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Prediction type</th>
                        <th className="py-1 pr-3 font-medium">Predictions</th>
                        <th className="py-1 pr-3 font-medium">Bias</th>
                        <th className="py-1 pr-3 font-medium">Mean abs. error (s)</th>
                        <th className="py-1 pr-3 font-medium">Within ±60 s</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.byUpdateType.map((t) => (
                        <tr key={t.updateType} className="border-t">
                          <td className="py-1 pr-3">{updateTypeLabel(t.updateType)}</td>
                          <td className="py-1 pr-3">{t.n}</td>
                          <td className="py-1 pr-3">{biasLabel(t.meanErrorSec)}</td>
                          <td className="py-1 pr-3">{Math.round(t.meanAbsErrorSec)}</td>
                          <td className="py-1 pr-3">{percent(t.within60sRatio)}%</td>
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
