// GET /api/analytics/heatmap の応答（曜日 × 時間帯のパターン。003 US4）
import { z } from "zod";
import { HEATMAP_METRICS } from "@/lib/metrics/heatmap";
import { analyticsMetaSchema, analyticsRouteSchema } from "./analytics";

export const heatmapMetricSchema = z.enum(HEATMAP_METRICS);

export const heatmapResponseSchema = analyticsMetaSchema.extend({
  metric: heatmapMetricSchema,
  /** null = すべての路線（運行間隔は Green の合算を除く。アラートは複数の路線のアラートを 1 回だけ数える） */
  route: analyticsRouteSchema.nullable(),
  /**
   * 月〜日 × 運行日の時間帯（3〜23, 0〜2）の 168 セル。値の単位は
   * headway_p90 = 秒、prediction_abs_error = 秒、alert_minutes = 日あたりの分。データがなければ null
   */
  cells: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      value: z.number().nullable(),
      n: z.number().int(),
    }),
  ),
});
export type HeatmapResponse = z.infer<typeof heatmapResponseSchema>;
