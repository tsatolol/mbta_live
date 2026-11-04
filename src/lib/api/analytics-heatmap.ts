// GET /api/analytics/heatmap（003 US4）: 曜日 × 時間帯（ET）の行列。指標は運行間隔の p90・予測の平均絶対誤差・
// 遅延系のアラートの分数。今日より前は集計テーブルから、今日の分は同じ SQL で計算して結合する
import "server-only";
import {
  computeAlertStats,
  computeHeadwayStats,
  computePredictionAccuracy,
} from "@/lib/db/analytics-sql";
import {
  readDisruptionMinutesHourly,
  readHeadwayHourly,
  readPredictionHourly,
} from "@/lib/db/analytics-read";
import { ALL_ROUTES } from "@/lib/metrics/alert-stats";
import { GREEN_COMBINED } from "@/lib/metrics/headways";
import {
  minutesHeatmap,
  startedHours,
  weightedHeatmap,
  type HeatmapCell,
  type MinutesHourRow,
  type WeightedHourRow,
} from "@/lib/metrics/heatmap";
import { addServiceDays, bostonHourOf, SERVICE_DAY_HOURS, type ServiceDate } from "@/lib/time";
import { analyticsRouteSchema } from "@/lib/api-schemas/analytics";
import { heatmapMetricSchema, heatmapResponseSchema } from "@/lib/api-schemas/analytics-heatmap";
import {
  analyticsContext,
  analyticsMeta,
  rangeQuerySchema,
  type AnalyticsContext,
} from "./analytics";
import { cachedToday } from "./today-cache";
import { errorResponse, okResponse, parseQuery, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

const querySchema = rangeQuerySchema.extend({
  metric: heatmapMetricSchema.default("headway_p90"),
  /** 省略時はすべての路線。Green（合算）は運行間隔だけ */
  route: analyticsRouteSchema.optional(),
});

/** 今日の分の行を (時間帯) ごとにまとめる */
function sumByHour<T>(
  rows: readonly T[],
  hourOf: (r: T) => number,
  n: (r: T) => number,
  weighted: (r: T) => number,
  serviceDate: ServiceDate,
): WeightedHourRow[] {
  const m = new Map<number, WeightedHourRow>();
  for (const r of rows) {
    const h = hourOf(r);
    const cur = m.get(h) ?? { serviceDate, hour: h, n: 0, weightedSum: 0 };
    cur.n += n(r);
    cur.weightedSum += weighted(r);
    m.set(h, cur);
  }
  return [...m.values()];
}

async function headwayCells(
  deps: ApiDeps,
  ctx: AnalyticsContext,
  route?: string,
): Promise<HeatmapCell[]> {
  const [aggregated, today] = await Promise.all([
    ctx.aggregated ? readHeadwayHourly(deps.db, ctx.aggregated.from, ctx.aggregated.to, route) : [],
    ctx.todayIncluded
      ? cachedToday(`headways|${ctx.today}`, deps.clock.now().getTime(), () =>
          computeHeadwayStats(deps.db, ctx.today),
        )
      : [],
  ]);
  const todayRows = sumByHour(
    today.filter((r) =>
      route === undefined ? r.route_id !== GREEN_COMBINED : r.route_id === route,
    ),
    (r) => r.hour,
    (r) => r.n,
    (r) => r.p90_sec * r.n,
    ctx.today,
  );
  return weightedHeatmap([...aggregated, ...todayRows]);
}

async function predictionCells(
  deps: ApiDeps,
  ctx: AnalyticsContext,
  route?: string,
): Promise<HeatmapCell[]> {
  const [aggregated, today] = await Promise.all([
    ctx.aggregated
      ? readPredictionHourly(deps.db, ctx.aggregated.from, ctx.aggregated.to, route)
      : [],
    ctx.todayIncluded
      ? cachedToday(`predictions|${ctx.today}`, deps.clock.now().getTime(), () =>
          computePredictionAccuracy(deps.db, ctx.today),
        )
      : [],
  ]);
  const todayRows = sumByHour(
    today.filter((r) => route === undefined || r.route_id === route),
    (r) => r.hour,
    (r) => r.n,
    (r) => r.mean_abs_error_sec * r.n,
    ctx.today,
  );
  return weightedHeatmap([...aggregated, ...todayRows]);
}

async function alertCells(
  deps: ApiDeps,
  ctx: AnalyticsContext,
  aggregatedDates: readonly ServiceDate[],
  route?: string,
): Promise<HeatmapCell[]> {
  const routeId = route ?? ALL_ROUTES;
  const [aggregated, today] = await Promise.all([
    ctx.aggregated
      ? readDisruptionMinutesHourly(deps.db, ctx.aggregated.from, ctx.aggregated.to, routeId)
      : [],
    ctx.todayIncluded
      ? cachedToday(`alerts|${ctx.today}`, deps.clock.now().getTime(), () =>
          computeAlertStats(deps.db, ctx.today),
        )
      : null,
  ]);
  const todayRows: MinutesHourRow[] = (today?.hourly ?? [])
    .filter((r) => r.route_id === routeId && r.category === "disruption")
    .map((r) => ({ serviceDate: ctx.today, hour: r.hour, minutes: r.active_minutes }));
  // 分母: 集計済みの日はすべての時間帯、今日は始まっている時間帯だけ
  const days = [
    ...aggregatedDates.map((serviceDate) => ({ serviceDate, hours: SERVICE_DAY_HOURS })),
    ...(ctx.todayIncluded
      ? [{ serviceDate: ctx.today, hours: startedHours(bostonHourOf(deps.clock.now())) }]
      : []),
  ];
  return minutesHeatmap([...aggregated, ...todayRows], days);
}

export function getAnalyticsHeatmap(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/analytics/heatmap", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const { metric, route } = query.data;
      if (route === GREEN_COMBINED && metric !== "headway_p90") {
        return errorResponse(400, "Invalid query parameter: route=Green is only for headway_p90");
      }
      const context = analyticsContext(deps.clock, query.data);
      if (!context.ok) return context.response;
      const { ctx } = context;

      const meta = await analyticsMeta(deps.db, deps.clock, ctx);
      const aggregatedDates: ServiceDate[] = [];
      for (const v of meta.definitionVersions) {
        for (let d = v.from; d <= v.to; d = addServiceDays(d, 1)) {
          if (d !== ctx.today) aggregatedDates.push(d);
        }
      }
      const cells =
        metric === "headway_p90"
          ? await headwayCells(deps, ctx, route)
          : metric === "prediction_abs_error"
            ? await predictionCells(deps, ctx, route)
            : await alertCells(deps, ctx, aggregatedDates, route);

      return okResponse(heatmapResponseSchema, { ...meta, metric, route: route ?? null, cells });
    });
}
