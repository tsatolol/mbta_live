// GET /api/live/alerts の応答（駅の到着表示の応答でも使う）
import { z } from "zod";
import { isoDateTime, liveMetaSchema } from "./common";

/** 一度に返すアラートの最大数 */
export const ALERTS_LIMIT = 200;

/** GET /api/live/alerts の status パラメータ（all は過去のアラートも含む） */
export const alertStatusFilterSchema = z.enum(["active", "upcoming", "all"]);
export type AlertStatusFilter = z.infer<typeof alertStatusFilterSchema>;

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
  /** 有効な区間。フィードから消えたアラートは、最後に見た時刻で終わらせた区間 */
  activePeriod: z.array(z.object({ start: isoDateTime, end: isoDateTime.nullable() })),
  routeIds: z.array(z.string()),
  /** 今の MBTA のフィードにあるか（なければ過去のアラート） */
  inFeed: z.boolean(),
  updatedAt: isoDateTime.nullable(),
});
export type AlertItem = z.infer<typeof alertSchema>;

export const alertsResponseSchema = liveMetaSchema.extend({
  /** 重要度の高い順（同じなら更新の新しい順）。多すぎるときは先頭の ALERTS_LIMIT 件 */
  alerts: z.array(alertSchema),
  /** 条件に合うアラートが ALERTS_LIMIT 件より多く、切り詰めたか */
  truncated: z.boolean(),
});
export type AlertsResponse = z.infer<typeof alertsResponseSchema>;
