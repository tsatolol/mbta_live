// GET /api/analytics/headways（003 US1）: 運行間隔の日別・時間帯別の統計と、団子運転・間隔の開きの件数。
// 今日より前は daily_headway_stats から、今日の分は同じ SQL で生データから計算して結合する
import "server-only";
import { z } from "zod";
import { computeHeadwayStats } from "@/lib/db/analytics-sql";
import { readHeadwayStats, stopNames, type HeadwayReadRow } from "@/lib/db/analytics-read";
import { summarizeHeadways } from "@/lib/metrics/headways";
import { SERVICE_DAY_HOURS } from "@/lib/time";
import { analyticsRouteSchema, directionParamSchema } from "@/lib/api-schemas/analytics";
import { headwaysResponseSchema } from "@/lib/api-schemas/analytics-headways";
import { analyticsContext, analyticsMeta, rangeQuerySchema } from "./analytics";
import { cachedToday } from "./today-cache";
import { okResponse, parseQuery, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

const querySchema = rangeQuerySchema.extend({
  /** 既定は Red */
  route: analyticsRouteSchema.default("Red"),
  direction: directionParamSchema.optional(),
  stop: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.:-]+$/, "invalid stop id")
    .optional(),
});

export function getAnalyticsHeadways(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/analytics/headways", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const { route, direction, stop } = query.data;
      const context = analyticsContext(deps.clock, query.data);
      if (!context.ok) return context.response;
      const { ctx } = context;
      // 駅では絞らずに読み、駅の選択肢（期間内にデータがある駅）を作ってから絞る
      const filter = { routeId: route, directionId: direction };
      const [meta, aggregated, today] = await Promise.all([
        analyticsMeta(deps.db, deps.clock, ctx),
        ctx.aggregated
          ? readHeadwayStats(deps.db, ctx.aggregated.from, ctx.aggregated.to, filter)
          : Promise.resolve([]),
        ctx.todayIncluded
          ? cachedToday(`headways|${ctx.today}`, deps.clock.now().getTime(), () =>
              computeHeadwayStats(deps.db, ctx.today),
            )
          : Promise.resolve([]),
      ]);
      const todayRows: HeadwayReadRow[] = today
        .filter(
          (r) => r.route_id === route && (direction === undefined || r.direction_id === direction),
        )
        .map((r) => ({
          serviceDate: ctx.today,
          directionId: r.direction_id,
          stopId: r.stop_id,
          hour: r.hour,
          n: r.n,
          meanSec: r.mean_sec,
          p50Sec: r.p50_sec,
          p90Sec: r.p90_sec,
          maxSec: r.max_sec,
          bunchingCount: r.bunching_count,
          gapCount: r.gap_count,
        }));
      const allRows = [...aggregated, ...todayRows];
      const rows = stop ? allRows.filter((r) => r.stopId === stop) : allRows;
      const stopIds = [...new Set([...allRows.map((r) => r.stopId), ...(stop ? [stop] : [])])];
      const names = await stopNames(deps.db, stopIds);
      const summary = summarizeHeadways(rows, SERVICE_DAY_HOURS);

      return okResponse(headwaysResponseSchema, {
        ...meta,
        route,
        direction: direction ?? null,
        stop: stop ? { id: stop, name: names.get(stop) ?? stop } : null,
        stops: stopIds
          .map((id) => ({ id, name: names.get(id) ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        ...summary,
      });
    });
}
