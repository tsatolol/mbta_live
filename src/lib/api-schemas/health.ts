// GET /api/health の応答（specs/002-live-dashboard/contracts/live-api.md）。
// Route Handler、スモークテスト、監視で共有する。
import { z } from "zod";

export const healthResponseSchema = z.object({
  /** DB に接続できれば ok。できなければ error（HTTP 503） */
  status: z.enum(["ok", "error"]),
  /** 応答を作ったときのサーバーの時刻（ISO 8601、UTC） */
  checkedAt: z.iso.datetime(),
  /** collector の最後の成功時刻。まだなければ null */
  lastCollectedAt: z.iso.datetime().nullable(),
  /** 前の運行日（YYYY-MM-DD） */
  previousServiceDate: z.iso.date(),
  /** 前の運行日の集計（aggregate_runs）が成功しているか */
  previousServiceDateAggregated: z.boolean(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** DB に接続できなかったときの応答（HTTP 503） */
export const healthErrorResponseSchema = z.object({
  status: z.literal("error"),
  checkedAt: z.iso.datetime(),
});

export type HealthErrorResponse = z.infer<typeof healthErrorResponseSchema>;
