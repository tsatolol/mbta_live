// GET /api/analytics/predictions の応答（到着予測の精度。003 US2）
import { z } from "zod";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { UPDATE_TYPES } from "@/lib/metrics/prediction-accuracy";
import { analyticsMetaSchema, serviceDateSchema } from "./analytics";

export const updateTypeSchema = z.enum(UPDATE_TYPES);

export const accuracyValuesSchema = z.object({
  /** 突き合わせた予測の数 */
  n: z.number().int(),
  /** 平均誤差（バイアス）。正 = 予測より遅く到着 */
  meanErrorSec: z.number(),
  meanAbsErrorSec: z.number(),
  /** まとめた値は件数で重み付けした平均（近似） */
  p90AbsErrorSec: z.number(),
  within60sRatio: z.number().min(0).max(1),
});

export const predictionsResponseSchema = analyticsMetaSchema.extend({
  route: z.enum(TARGET_ROUTE_IDS).nullable(),
  direction: z.number().int().nullable(),
  updateType: updateTypeSchema.nullable(),
  /** リード時間（分）ごと。短い順 */
  byLead: z.array(accuracyValuesSchema.extend({ leadBucketMin: z.number().int() })),
  /** 予測の種類ごと */
  byUpdateType: z.array(accuracyValuesSchema.extend({ updateType: z.string() })),
  daily: z.array(accuracyValuesSchema.extend({ serviceDate: serviceDateSchema })),
  totals: accuracyValuesSchema.nullable(),
});
export type PredictionsAnalyticsResponse = z.infer<typeof predictionsResponseSchema>;
