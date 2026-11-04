// GET /api/status の応答（稼働状況）
import { z } from "zod";
import { isoDateTime, liveMetaSchema } from "./common";

export const jobRunSchema = z.object({
  job: z.string(),
  status: z.string(),
  startedAt: isoDateTime,
  finishedAt: isoDateTime.nullable(),
  counts: z.record(z.string(), z.number()).nullable(),
  error: z.string().nullable(),
});
export type JobRun = z.infer<typeof jobRunSchema>;

export const statusResponseSchema = liveMetaSchema.extend({
  /** ジョブごとの直近の実行 */
  jobs: z.array(
    z.object({
      job: z.string(),
      lastRun: jobRunSchema.nullable(),
      lastSuccessAt: isoDateTime.nullable(),
      /** 新しい順 */
      recentRuns: z.array(jobRunSchema),
      /** 直近 24 時間の実行の数と、そのうち失敗した数 */
      runsLast24h: z.number().int(),
      failedLast24h: z.number().int(),
    }),
  ),
  /** 最後の collector の実行で見た MBTA API のレート制限の残量 */
  rateLimitRemaining: z.number().int().nullable(),
  /** テーブルごとの行数（大きなテーブルは推定値） */
  tables: z.array(z.object({ name: z.string(), rows: z.number().int(), estimated: z.boolean() })),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;
