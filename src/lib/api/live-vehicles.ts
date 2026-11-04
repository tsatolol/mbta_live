// GET /api/live/vehicles（US1）: 現在の車両の位置。routes（カンマ区切り）で絞り込める
import "server-only";
import { z } from "zod";
import type { Clock } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { listVehicles } from "@/lib/db/live";
import { isTargetRouteId } from "@/lib/mbta/constants";
import { isStale } from "@/lib/metrics/live";
import { routeListParamSchema } from "@/lib/api-schemas/common";
import { vehiclesResponseSchema } from "@/lib/api-schemas/vehicles";
import { liveMeta, okResponse, parseQuery, withErrorHandling } from "./handler";

export interface ApiDeps {
  db: Db;
  clock: Clock;
}

const querySchema = z.object({
  routes: routeListParamSchema.refine(
    (ids) => ids === undefined || ids.every(isTargetRouteId),
    "unknown route",
  ),
});

export function getVehicles(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/live/vehicles", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const now = deps.clock.now();
      const [meta, vehicles] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        listVehicles(deps.db, query.data.routes),
      ]);
      return okResponse(vehiclesResponseSchema, {
        ...meta,
        vehicles: vehicles.map((v) => ({
          id: v.vehicleId,
          label: v.label,
          routeId: v.routeId,
          routeColor: v.routeColor,
          tripId: v.tripId,
          directionId: v.directionId,
          destination: v.destination,
          lat: v.lat,
          lon: v.lon,
          bearing: v.bearing,
          currentStatus: v.currentStatus,
          stopId: v.stopId,
          stopName: v.stopName,
          updatedAt: v.updatedAt.toISOString(),
          isStale: isStale(v.updatedAt, now),
        })),
      });
    });
}
