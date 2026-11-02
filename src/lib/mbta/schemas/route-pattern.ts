// /route_patterns の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/route_patterns」）
import { z } from "zod";
import { isTargetRouteId } from "../constants";
import { parseDocument, type ParsedDocument } from "../jsonapi";
import { relationId, requiredRelationId } from "./common";

export const routePatternRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("route_pattern"),
    attributes: z.object({
      direction_id: z.number().int(),
      name: z.string(),
      typicality: z.number().int(),
      canonical: z.boolean(),
    }),
    relationships: z.object({
      route: requiredRelationId,
      representative_trip: requiredRelationId,
    }),
  })
  .transform(({ id, attributes: a, relationships: r }) => ({
    id,
    routeId: r.route,
    representativeTripId: r.representative_trip,
    directionId: a.direction_id,
    name: a.name,
    typicality: a.typicality,
    canonical: a.canonical,
  }));

const tripSchema = z.object({
  id: z.string(),
  type: z.literal("trip"),
  relationships: z.object({
    shape: relationId,
    stops: z.object({ data: z.array(z.object({ id: z.string() })) }).optional(),
  }),
});

const shapeSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  attributes: z.object({ polyline: z.string() }),
});

export interface RoutePattern {
  id: string;
  routeId: string;
  directionId: number;
  name: string;
  typicality: number;
  canonical: boolean;
  shapePolyline: string | null;
  /** 停車順のホーム ID（代表の便 representative_trip の停車順） */
  platformStopIds: string[];
}

/**
 * 路線パターンを解析し、対象 8 路線のもの（Shuttle-* などを除く）を返す。
 * 停車順と形状は included の trip / shape から取る
 */
export function parseRoutePatterns(body: unknown): ParsedDocument<RoutePattern> {
  const parsed = parseDocument(body, routePatternRowSchema);
  const trips = new Map<string, z.output<typeof tripSchema>>();
  const shapes = new Map<string, string>();
  for (const row of parsed.included) {
    const trip = tripSchema.safeParse(row);
    if (trip.success) trips.set(trip.data.id, trip.data);
    const shape = shapeSchema.safeParse(row);
    if (shape.success) shapes.set(shape.data.id, shape.data.attributes.polyline);
  }
  const rows = parsed.rows
    .filter((p) => isTargetRouteId(p.routeId))
    .map(({ representativeTripId, ...p }) => {
      const trip = trips.get(representativeTripId);
      const shapeId = trip?.relationships.shape ?? null;
      return {
        ...p,
        shapePolyline: shapeId === null ? null : (shapes.get(shapeId) ?? null),
        platformStopIds: trip?.relationships.stops?.data.map((s) => s.id) ?? [],
      };
    });
  return { ...parsed, rows };
}
