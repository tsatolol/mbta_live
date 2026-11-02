// /predictions の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/predictions」）
import { z } from "zod";
import { parseDocument, type ParsedDocument } from "../jsonapi";
import { mbtaDateTime, relationId, requiredRelationId } from "./common";

export const predictionRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("prediction"),
    attributes: z.object({
      // 始発駅では arrival_time が null、CANCELLED では両方 null
      arrival_time: mbtaDateTime.nullable(),
      departure_time: mbtaDateTime.nullable(),
      direction_id: z.number().int(),
      stop_sequence: z.number().int().nullable().optional(),
      // 値は列挙型にせず文字列のまま（null = 時刻表どおり）
      schedule_relationship: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      update_type: z.string().nullable().optional(),
      arrival_uncertainty: z.number().int().nullable().optional(),
      departure_uncertainty: z.number().int().nullable().optional(),
    }),
    relationships: z.object({
      route: requiredRelationId,
      stop: requiredRelationId,
      trip: requiredRelationId,
      vehicle: relationId,
    }),
  })
  .transform(({ id, attributes: a, relationships: r }) => ({
    id,
    routeId: r.route,
    tripId: r.trip,
    stopId: r.stop,
    vehicleId: r.vehicle,
    directionId: a.direction_id,
    stopSequence: a.stop_sequence ?? null,
    arrivalTime: a.arrival_time,
    departureTime: a.departure_time,
    status: a.status ?? null,
    scheduleRelationship: a.schedule_relationship ?? null,
    updateType: a.update_type ?? null,
    uncertaintySec: a.arrival_uncertainty ?? a.departure_uncertainty ?? null,
  }));

export type Prediction = z.output<typeof predictionRowSchema>;

export function parsePredictions(body: unknown): ParsedDocument<Prediction> {
  return parseDocument(body, predictionRowSchema);
}
