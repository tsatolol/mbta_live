// GET /api/live/vehicles の応答
import { z } from "zod";
import { isoDateTime, liveMetaSchema } from "./common";

export const vehicleSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  routeId: z.string(),
  routeColor: z.string(),
  tripId: z.string().nullable(),
  directionId: z.number().int().nullable(),
  /** 行先（路線の direction_destinations。便ごとの行先は持っていない） */
  destination: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  bearing: z.number().nullable(),
  currentStatus: z.string(),
  stopId: z.string().nullable(),
  /** 次の駅（stop_id の親駅の名前）。stop_id が null なら null */
  stopName: z.string().nullable(),
  updatedAt: isoDateTime,
  /** updated_at が 3 分以上前 */
  isStale: z.boolean(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

export const vehiclesResponseSchema = liveMetaSchema.extend({
  vehicles: z.array(vehicleSchema),
});
export type VehiclesResponse = z.infer<typeof vehiclesResponseSchema>;
