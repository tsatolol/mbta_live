// GET /api/analytics/alerts（003 US3）: 日別の遅延系・お知らせ系のアラートの件数と分数、effect ごと・cause ごとの内訳。
// 今日より前は daily_alert_stats から、今日の分は同じ SQL で計算して結合する
import "server-only";
import { z } from "zod";
import { computeAlertStats } from "@/lib/db/analytics-sql";
import { readAlertStats, type AlertStatReadRow } from "@/lib/db/analytics-read";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { ALL_ROUTES, summarizeAlertStats } from "@/lib/metrics/alert-stats";
import { addServiceDays, type ServiceDate } from "@/lib/time";
import { alertsAnalyticsResponseSchema } from "@/lib/api-schemas/analytics-alerts";
import { analyticsContext, analyticsMeta, rangeQuerySchema } from "./analytics";
import { cachedToday } from "./today-cache";
import { okResponse, parseQuery, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

const querySchema = rangeQuerySchema.extend({
  /** 省略時はすべての路線 */
  route: z.enum(TARGET_ROUTE_IDS).optional(),
});

export function getAnalyticsAlerts(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/analytics/alerts", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const routeId = query.data.route ?? ALL_ROUTES;
      const context = analyticsContext(deps.clock, query.data);
      if (!context.ok) return context.response;
      const { ctx } = context;

      const [meta, aggregated, today] = await Promise.all([
        analyticsMeta(deps.db, deps.clock, ctx),
        ctx.aggregated
          ? readAlertStats(deps.db, ctx.aggregated.from, ctx.aggregated.to, routeId)
          : Promise.resolve([]),
        ctx.todayIncluded
          ? cachedToday(`alerts|${ctx.today}`, deps.clock.now().getTime(), () =>
              computeAlertStats(deps.db, ctx.today),
            )
          : Promise.resolve(null),
      ]);
      const todayRows: AlertStatReadRow[] = (today?.daily ?? [])
        .filter((r) => r.route_id === routeId)
        .map((r) => ({
          serviceDate: ctx.today,
          effect: r.effect,
          cause: r.cause,
          alertCount: r.alert_count,
          activeMinutes: r.active_minutes,
        }));
      // 日別に出すのは、集計済みの運行日と今日だけ（集計していない日を 0 件に見せない）
      const dates: ServiceDate[] = [];
      for (const v of meta.definitionVersions) {
        for (let d = v.from; d <= v.to; d = addServiceDays(d, 1)) dates.push(d);
      }

      return okResponse(alertsAnalyticsResponseSchema, {
        ...meta,
        route: query.data.route ?? null,
        ...summarizeAlertStats([...aggregated, ...todayRows], dates),
      });
    });
}
