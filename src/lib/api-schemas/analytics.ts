// 分析の内部 API（003）の共通部分の型（specs/003-analytics/contracts/analytics-api.md）。
// Route Handler（応答を組み立てる側）と画面（受け取る側）の両方で使う
import { z } from "zod";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { isServiceDate } from "@/lib/time";
import { liveMetaSchema } from "./common";

/** 運行日（YYYY-MM-DD） */
export const serviceDateSchema = z.string().refine(isServiceDate, "expected YYYY-MM-DD");

/** 分析で選べる路線: 8 路線と、Green の全支線の合算（運行間隔だけ） */
export const ANALYTICS_ROUTE_IDS = [...TARGET_ROUTE_IDS, "Green"] as const;
export const analyticsRouteSchema = z.enum(ANALYTICS_ROUTE_IDS);
export type AnalyticsRouteId = z.infer<typeof analyticsRouteSchema>;

/** 方向（0 / 1） */
export const directionParamSchema = z.enum(["0", "1"]).transform(Number);

/** 範囲内の運行日が、どの定義の版で集計されたか（連続する同じ版を 1 つの区間にまとめる） */
export const definitionVersionRangeSchema = z.object({
  version: z.number().int(),
  from: serviceDateSchema,
  to: serviceDateSchema,
});
export type DefinitionVersionRange = z.infer<typeof definitionVersionRangeSchema>;

/** 分析 API の応答に共通の項目 */
export const analyticsMetaSchema = liveMetaSchema.extend({
  /** 実際に使った期間（運行日、両端を含む） */
  from: serviceDateSchema,
  to: serviceDateSchema,
  /** 範囲に今日（まだ集計されていない運行日）が含まれ、生データから計算したか */
  todayIncluded: z.boolean(),
  /** 最後に集計に成功した運行日（なければ null） */
  lastAggregatedServiceDate: serviceDateSchema.nullable(),
  /** 範囲内の運行日の集計に使われた定義の版。今日の分は今の版 */
  definitionVersions: z.array(definitionVersionRangeSchema),
});
export type AnalyticsMeta = z.infer<typeof analyticsMetaSchema>;
