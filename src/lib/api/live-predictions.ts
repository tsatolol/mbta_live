// GET /api/live/predictions（US2）: 駅の到着表示。親駅（stop）に属するホームの予測を方向別に次の 3 本と、
// その駅と路線に有効なアラート
import "server-only";
import { z } from "zod";
import {
  getStation,
  listFeedAlertsForRoutes,
  listPredictionsAtStops,
  listStationDirections,
} from "@/lib/db/live";
import { predictionsResponseSchema } from "@/lib/api-schemas/predictions";
import { alertAppliesToStation, nextArrivals } from "@/lib/metrics/arrival-board";
import { errorResponse, liveMeta, okResponse, parseQuery, withErrorHandling } from "./handler";
import { parseInformedEntity, toAlertItem } from "./alert-item";
import type { ApiDeps } from "./live-vehicles";

const querySchema = z.object({
  stop: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_.:-]+$/, "invalid stop id"),
});

export function getPredictions(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/live/predictions", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const station = await getStation(deps.db, query.data.stop);
      if (!station) return errorResponse(404, `Station not found: ${query.data.stop}`);

      const now = deps.clock.now();
      const directions = await listStationDirections(deps.db, station.id);
      const routeIds = [...new Set(directions.map((d) => d.routeId))];
      const [meta, predictions, alerts] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        listPredictionsAtStops(deps.db, station.platformIds),
        listFeedAlertsForRoutes(deps.db, routeIds),
      ]);
      const stopIds = [station.id, ...station.platformIds];

      return okResponse(predictionsResponseSchema, {
        ...meta,
        stop: { id: station.id, name: station.name },
        directions: directions.map((d) => ({
          ...d,
          arrivals: nextArrivals(
            predictions.filter((p) => p.routeId === d.routeId && p.directionId === d.directionId),
            now,
          ).map((p) => ({
            tripId: p.tripId,
            vehicleId: p.vehicleId,
            time: p.time.toISOString(),
            timeKind: p.timeKind,
            cancelled: p.scheduleRelationship === "CANCELLED",
            status: p.status,
            uncertaintySec: p.uncertaintySec,
          })),
        })),
        alerts: alerts
          .filter((a) =>
            alertAppliesToStation(parseInformedEntity(a.informedEntity), { routeIds, stopIds }),
          )
          .map((a) => toAlertItem(a, now))
          .filter((a) => a.status === "active"),
      });
    });
}
