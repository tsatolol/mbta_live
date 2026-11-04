// GET /api/live/alerts（US3）: アラートの一覧。status（active / upcoming / all）、routes、effects、
// from / to（運行日 YYYY-MM-DD。その期間に有効だったもの）で絞り込む。過去のアラート（フィードから消えたもの）も検索できる
import "server-only";
import { z } from "zod";
import { listAlerts } from "@/lib/db/live";
import { isTargetRouteId } from "@/lib/mbta/constants";
import { alertOverlaps } from "@/lib/metrics/alerts";
import { isServiceDate, serviceDayRange } from "@/lib/time";
import { routeListParamSchema } from "@/lib/api-schemas/common";
import {
  ALERTS_LIMIT,
  alertStatusFilterSchema,
  alertsResponseSchema,
} from "@/lib/api-schemas/alerts";
import { liveMeta, okResponse, parseQuery, withErrorHandling } from "./handler";
import { parseActivePeriod, toAlertItem } from "./alert-item";
import type { ApiDeps } from "./live-vehicles";

const dateParam = z.string().refine(isServiceDate, "expected YYYY-MM-DD").optional();

const querySchema = z
  .object({
    status: alertStatusFilterSchema.default("active"),
    routes: routeListParamSchema.refine(
      (ids) => ids === undefined || ids.every(isTargetRouteId),
      "unknown route",
    ),
    effects: routeListParamSchema.refine(
      (values) => values === undefined || values.every((v) => /^[A-Z_]+$/.test(v)),
      "invalid effect",
    ),
    from: dateParam,
    to: dateParam,
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "from must not be after to",
    path: ["from"],
  });

export function getAlerts(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/live/alerts", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const { status, routes, effects, from, to } = query.data;
      const now = deps.clock.now();
      const [meta, rows] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        listAlerts(deps.db, { routeIds: routes, effects, inFeedOnly: status !== "all" }),
      ]);
      // 期間: from の運行日の始まり（ET 03:00）から to の運行日の終わりまで（src/lib/time.ts）
      const fromAt = from ? serviceDayRange(from).start : null;
      const toAt = to ? serviceDayRange(to).end : null;
      const matched = rows
        .filter(
          (row) =>
            (!fromAt && !toAt) ||
            alertOverlaps(
              {
                periods: parseActivePeriod(row.activePeriod),
                inFeed: row.inFeed,
                lastSeenAt: row.lastSeenAt,
              },
              fromAt ?? new Date(0),
              toAt ?? new Date(8.64e15),
            ),
        )
        .map((row) => toAlertItem(row, now))
        .filter((a) => status === "all" || a.status === status);
      return okResponse(alertsResponseSchema, {
        ...meta,
        alerts: matched.slice(0, ALERTS_LIMIT),
        truncated: matched.length > ALERTS_LIMIT,
      });
    });
}
