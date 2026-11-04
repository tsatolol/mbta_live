// GET /api/static/routes（US1）: 路線と、地図に描く路線形状（GeoJSON）
import "server-only";
import { listRouteShapes, listRoutes } from "@/lib/db/static-read";
import { decodePolyline } from "@/lib/geo/polyline";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { liveMeta, okResponse, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

export function getRoutes(deps: ApiDeps) {
  return () =>
    withErrorHandling("/api/static/routes", async () => {
      const [meta, routes, shapes] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        listRoutes(deps.db),
        listRouteShapes(deps.db),
      ]);
      const colorById = new Map(routes.map((r) => [r.id, r.color]));
      return okResponse(routesResponseSchema, {
        ...meta,
        routes,
        shapes: {
          type: "FeatureCollection",
          features: shapes
            .filter((s) => colorById.has(s.routeId))
            .map((s) => ({
              type: "Feature" as const,
              properties: {
                routeId: s.routeId,
                directionId: s.directionId,
                routePatternId: s.routePatternId,
                color: colorById.get(s.routeId) ?? "888888",
              },
              geometry: { type: "LineString" as const, coordinates: decodePolyline(s.polyline) },
            })),
        },
      });
    });
}
