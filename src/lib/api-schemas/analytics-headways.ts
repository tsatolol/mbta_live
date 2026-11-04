// GET /api/analytics/headways の応答（運行間隔。003 US1）
import { z } from "zod";
import { analyticsMetaSchema, analyticsRouteSchema, serviceDateSchema } from "./analytics";

export const headwayValuesSchema = z.object({
  /** 運行間隔の数 */
  n: z.number().int(),
  meanSec: z.number(),
  /** 日別・時間帯別にまとめた値は、件数で重み付けした平均（近似） */
  p50Sec: z.number(),
  p90Sec: z.number(),
  maxSec: z.number().int(),
  bunchingCount: z.number().int(),
  gapCount: z.number().int(),
});

export const headwaysResponseSchema = analyticsMetaSchema.extend({
  route: analyticsRouteSchema,
  direction: z.number().int().nullable(),
  stop: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** 期間内にデータがある駅（駅の絞り込みの選択肢） */
  stops: z.array(z.object({ id: z.string(), name: z.string() })),
  daily: z.array(headwayValuesSchema.extend({ serviceDate: serviceDateSchema })),
  /** 時間帯ごと（ET。運行日の時間帯の並び 3〜23, 0〜2） */
  byHour: z.array(headwayValuesSchema.extend({ hour: z.number().int().min(0).max(23) })),
  totals: z.object({
    n: z.number().int(),
    bunchingCount: z.number().int(),
    gapCount: z.number().int(),
  }),
});
export type HeadwaysResponse = z.infer<typeof headwaysResponseSchema>;
