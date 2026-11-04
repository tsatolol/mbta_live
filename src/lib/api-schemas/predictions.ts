// GET /api/live/predictions の応答（駅の到着表示）
import { z } from "zod";
import { alertSchema } from "./alerts";
import { isoDateTime, liveMetaSchema } from "./common";

export const arrivalSchema = z.object({
  tripId: z.string(),
  vehicleId: z.string().nullable(),
  /** 到着予定時刻（始発駅では出発予定時刻） */
  time: isoDateTime,
  timeKind: z.enum(["arrival", "departure"]),
  /** 運休（schedule_relationship が CANCELLED）。SKIPPED の便は応答に入れない */
  cancelled: z.boolean(),
  status: z.string().nullable(),
  uncertaintySec: z.number().int().nullable(),
});
export type Arrival = z.infer<typeof arrivalSchema>;

export const directionGroupSchema = z.object({
  routeId: z.string(),
  routeColor: z.string(),
  directionId: z.number().int(),
  directionName: z.string().nullable(),
  destination: z.string().nullable(),
  /** 次の 3 本（時刻の順） */
  arrivals: z.array(arrivalSchema).max(3),
});
export type DirectionGroup = z.infer<typeof directionGroupSchema>;

export const predictionsResponseSchema = liveMetaSchema.extend({
  stop: z.object({ id: z.string(), name: z.string() }),
  directions: z.array(directionGroupSchema),
  /** その駅と、その駅を通る路線に有効なアラート */
  alerts: z.array(alertSchema),
});
export type PredictionsResponse = z.infer<typeof predictionsResponseSchema>;
