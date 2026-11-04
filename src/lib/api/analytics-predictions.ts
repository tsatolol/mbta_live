// GET /api/analytics/predictions（003 US2）: リード時間ごと・予測の種類ごと・日別の予測誤差の統計。
// 今日より前は daily_prediction_accuracy から、今日の分は同じ SQL で生データから計算して結合する
import "server-only";
import { z } from "zod";
import { computePredictionAccuracy } from "@/lib/db/analytics-sql";
import { readPredictionAccuracy, type AccuracyReadRow } from "@/lib/db/analytics-read";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { combineAccuracy, groupAccuracy } from "@/lib/metrics/prediction-accuracy";
import { directionParamSchema } from "@/lib/api-schemas/analytics";
import {
  predictionsResponseSchema,
  updateTypeSchema,
} from "@/lib/api-schemas/analytics-predictions";
import { analyticsContext, analyticsMeta, rangeQuerySchema } from "./analytics";
import { okResponse, parseQuery, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

const querySchema = rangeQuerySchema.extend({
  /** 省略時はすべての路線 */
  route: z.enum(TARGET_ROUTE_IDS).optional(),
  direction: directionParamSchema.optional(),
  updateType: updateTypeSchema.optional(),
});

export function getAnalyticsPredictions(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/analytics/predictions", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const { route, direction, updateType } = query.data;
      const context = analyticsContext(deps.clock, query.data);
      if (!context.ok) return context.response;
      const { ctx } = context;
      const filter = { routeId: route, directionId: direction, updateType };

      const [meta, aggregated, today] = await Promise.all([
        analyticsMeta(deps.db, deps.clock, ctx),
        ctx.aggregated
          ? readPredictionAccuracy(deps.db, ctx.aggregated.from, ctx.aggregated.to, filter)
          : Promise.resolve([]),
        ctx.todayIncluded ? computePredictionAccuracy(deps.db, ctx.today) : Promise.resolve([]),
      ]);
      const todayRows: AccuracyReadRow[] = today
        .filter(
          (r) =>
            (route === undefined || r.route_id === route) &&
            (direction === undefined || r.direction_id === direction) &&
            (updateType === undefined || r.update_type === updateType),
        )
        .map((r) => ({
          serviceDate: ctx.today,
          routeId: r.route_id,
          directionId: r.direction_id,
          leadBucketMin: r.lead_bucket_min,
          updateType: r.update_type,
          hour: r.hour,
          n: r.n,
          meanErrorSec: r.mean_error_sec,
          meanAbsErrorSec: r.mean_abs_error_sec,
          p90AbsErrorSec: r.p90_abs_error_sec,
          within60sRatio: r.within_60s_ratio,
        }));
      const rows = [...aggregated, ...todayRows];

      const byLead = groupAccuracy(rows, (r) => r.leadBucketMin);
      const byType = groupAccuracy(rows, (r) => r.updateType);
      const byDate = groupAccuracy(rows, (r) => r.serviceDate);
      return okResponse(predictionsResponseSchema, {
        ...meta,
        route: route ?? null,
        direction: direction ?? null,
        updateType: updateType ?? null,
        byLead: [...byLead]
          .sort(([a], [b]) => a - b)
          .map(([leadBucketMin, v]) => ({ leadBucketMin, ...v })),
        byUpdateType: [...byType]
          .sort(([, a], [, b]) => b.n - a.n)
          .map(([t, v]) => ({ updateType: t, ...v })),
        daily: [...byDate]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([serviceDate, v]) => ({ serviceDate, ...v })),
        totals: combineAccuracy(rows),
      });
    });
}
