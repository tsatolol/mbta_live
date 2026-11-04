// GET /api/static/routes の応答（路線と路線形状）
import { z } from "zod";
import { liveMetaSchema } from "./common";

export const routeInfoSchema = z.object({
  id: z.string(),
  shortName: z.string(),
  longName: z.string(),
  color: z.string(),
  textColor: z.string(),
  sortOrder: z.number().int(),
  directionNames: z.array(z.string().nullable()),
  directionDestinations: z.array(z.string().nullable()),
});
export type RouteInfo = z.infer<typeof routeInfoSchema>;

/** 路線形状（GeoJSON の LineString。座標は [lon, lat]） */
export const routeShapeFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    routeId: z.string(),
    directionId: z.number().int(),
    routePatternId: z.string(),
    color: z.string(),
  }),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
});

export const routesResponseSchema = liveMetaSchema.extend({
  routes: z.array(routeInfoSchema),
  shapes: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(routeShapeFeatureSchema),
  }),
});
export type RoutesResponse = z.infer<typeof routesResponseSchema>;
