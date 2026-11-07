// GET /api/static/stops（US2）: 路線ごとの親駅の一覧（停車順）。route で 1 路線に絞り込める
import "server-only";
import { z } from "zod";
import { listRouteStations, listStationPatterns } from "@/lib/db/static-read";
import { isTargetRouteId } from "@/lib/mbta/constants";
import { routeIdSchema } from "@/lib/api-schemas/common";
import { stopsResponseSchema } from "@/lib/api-schemas/stops";
import { liveMeta, okResponse, parseQuery, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

const querySchema = z.object({
  route: routeIdSchema.refine(isTargetRouteId, "unknown route").optional(),
});

export function getStops(deps: ApiDeps) {
  return (request: Request) =>
    withErrorHandling("/api/static/stops", async () => {
      const query = parseQuery(request, querySchema);
      if (!query.ok) return query.response;
      const [meta, routes] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        listRouteStations(deps.db, query.data.route),
      ]);
      const patterns = await listStationPatterns(deps.db, routes, query.data.route);
      return okResponse(stopsResponseSchema, { ...meta, routes, patterns });
    });
}
