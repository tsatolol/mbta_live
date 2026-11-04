// GET /api/static/stops の応答（路線ごとの親駅の一覧）
import { z } from "zod";
import { liveMetaSchema } from "./common";

export const stationSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});
export type Station = z.infer<typeof stationSchema>;

export const stopsResponseSchema = liveMetaSchema.extend({
  routes: z.array(
    z.object({
      routeId: z.string(),
      routeName: z.string(),
      routeColor: z.string(),
      /** 路線の停車順 */
      stations: z.array(stationSchema),
    }),
  ),
});
export type StopsResponse = z.infer<typeof stopsResponseSchema>;
