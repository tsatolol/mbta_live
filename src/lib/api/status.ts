// GET /api/status（US4）: ジョブごとの直近の実行結果、レート制限の残量、テーブルごとの行数
import "server-only";
import { countTableRows, getRateLimitRemaining, STATUS_JOBS, summarizeJob } from "@/lib/db/status";
import { statusResponseSchema, type JobRun } from "@/lib/api-schemas/status";
import type { JobRunRow } from "@/lib/db/status";
import { liveMeta, okResponse, withErrorHandling } from "./handler";
import type { ApiDeps } from "./live-vehicles";

/** ジョブごとに返す直近の実行の数 */
export const RECENT_RUNS = 10;
/** 実行と失敗の数を数える期間 */
const WINDOW_MS = 24 * 3600_000;

function toJobRun(r: JobRunRow): JobRun {
  return {
    job: r.job,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    counts: r.counts,
    error: r.error,
  };
}

export function getStatus(deps: ApiDeps) {
  return () =>
    withErrorHandling("/api/status", async () => {
      const since = new Date(deps.clock.now().getTime() - WINDOW_MS);
      const [meta, jobs, rateLimitRemaining, tables] = await Promise.all([
        liveMeta(deps.db, deps.clock),
        Promise.all(STATUS_JOBS.map((job) => summarizeJob(deps.db, job, since, RECENT_RUNS))),
        getRateLimitRemaining(deps.db),
        countTableRows(deps.db),
      ]);
      return okResponse(statusResponseSchema, {
        ...meta,
        jobs: jobs.map((j) => ({
          job: j.job,
          lastRun: j.recentRuns[0] ? toJobRun(j.recentRuns[0]) : null,
          lastSuccessAt: j.lastSuccessAt?.toISOString() ?? null,
          recentRuns: j.recentRuns.map(toJobRun),
          runsLast24h: j.runsSince,
          failedLast24h: j.failedSince,
        })),
        rateLimitRemaining,
        tables,
      });
    });
}
