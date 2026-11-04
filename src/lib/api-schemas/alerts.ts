// GET /api/live/alerts の応答（駅の到着表示の応答でも使う）
import { z } from "zod";
import { isoDateTime, liveMetaSchema } from "./common";

export const alertStatusSchema = z.enum(["active", "upcoming", "past"]);

export const alertSchema = z.object({
  id: z.string(),
  effect: z.string(),
  cause: z.string(),
  severity: z.number().int(),
  header: z.string(),
  shortHeader: z.string().nullable(),
  description: z.string().nullable(),
  serviceEffect: z.string().nullable(),
  timeframe: z.string().nullable(),
  lifecycle: z.string(),
  /** active_period と現在時刻から計算した状態 */
  status: alertStatusSchema,
  activePeriod: z.array(z.object({ start: isoDateTime, end: isoDateTime.nullable() })),
  routeIds: z.array(z.string()),
  /** 今の MBTA のフィードにあるか（なければ過去のアラート） */
  inFeed: z.boolean(),
  updatedAt: isoDateTime.nullable(),
});
export type AlertItem = z.infer<typeof alertSchema>;

export const alertsResponseSchema = liveMetaSchema.extend({
  alerts: z.array(alertSchema),
});
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;
