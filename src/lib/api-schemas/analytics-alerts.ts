// GET /api/analytics/alerts の応答（アラートの傾向。003 US3）
import { z } from "zod";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { analyticsMetaSchema, serviceDateSchema } from "./analytics";

export const alertCategorySchema = z.enum(["disruption", "notice"]);

/** 件数は「アラート × 日」（同じアラートが 3 日続けば 3）。分数はアラートごとの分数の合計 */
export const alertAmountSchema = z.object({
  alertCount: z.number().int(),
  activeMinutes: z.number().int(),
});

export const alertsAnalyticsResponseSchema = analyticsMetaSchema.extend({
  /** null = すべての路線（複数の路線のアラートは 1 回だけ数える） */
  route: z.enum(TARGET_ROUTE_IDS).nullable(),
  /** 集計済みの運行日と今日（古い順）。アラートがなければ 0 */
  daily: z.array(
    z.object({
      serviceDate: serviceDateSchema,
      disruption: alertAmountSchema,
      notice: alertAmountSchema,
    }),
  ),
  /** effect ごと（分数の多い順） */
  byEffect: z.array(
    alertAmountSchema.extend({ effect: z.string(), category: alertCategorySchema }),
  ),
  /** cause ごと（分数の多い順） */
  byCause: z.array(alertAmountSchema.extend({ cause: z.string() })),
  totals: z.object({ disruption: alertAmountSchema, notice: alertAmountSchema }),
});
export type AlertsAnalyticsResponse = z.infer<typeof alertsAnalyticsResponseSchema>;
