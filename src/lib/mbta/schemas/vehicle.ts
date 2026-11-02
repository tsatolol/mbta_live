// /vehicles の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/vehicles」）
import { z } from "zod";
import { parseDocument, type ParsedDocument } from "../jsonapi";
import { mbtaDateTime, relationId, requiredRelationId } from "./common";

/** 車両（車体）ごとの混雑情報。DB には JSON で保存する */
const carriageSchema = z
  .object({
    label: z.string().nullable().optional(),
    occupancy_status: z.string().nullable().optional(),
    occupancy_percentage: z.number().nullable().optional(),
  })
  .transform((c) => ({
    label: c.label ?? null,
    occupancyStatus: c.occupancy_status ?? null,
    occupancyPercentage: c.occupancy_percentage ?? null,
  }));

export const vehicleRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("vehicle"),
    attributes: z.object({
      latitude: z.number(),
      longitude: z.number(),
      bearing: z.number().nullable().optional(),
      current_status: z.string(),
      current_stop_sequence: z.number().int().nullable().optional(),
      direction_id: z.number().int().nullable().optional(),
      label: z.string().nullable().optional(),
      revenue: z.string().nullable().optional(),
      speed: z.number().nullable().optional(),
      carriages: z.array(carriageSchema).nullable().optional(),
      updated_at: mbtaDateTime,
    }),
    relationships: z.object({
      route: requiredRelationId,
      stop: relationId,
      trip: relationId,
    }),
  })
  .transform(({ id, attributes: a, relationships: r }) => ({
    vehicleId: id,
    routeId: r.route,
    tripId: r.trip,
    stopId: r.stop,
    directionId: a.direction_id ?? null,
    lat: a.latitude,
    lon: a.longitude,
    bearing: a.bearing == null ? null : Math.round(a.bearing),
    currentStatus: a.current_status,
    currentStopSequence: a.current_stop_sequence ?? null,
    label: a.label ?? null,
    revenue: a.revenue ?? null,
    speed: a.speed ?? null,
    carriages: a.carriages ?? null,
    updatedAt: a.updated_at,
  }));

export type Vehicle = z.output<typeof vehicleRowSchema>;

export function parseVehicles(body: unknown): ParsedDocument<Vehicle> {
  return parseDocument(body, vehicleRowSchema);
}
