// /api/health の中身: DB への接続、collector の最後の成功、前の運行日の集計の有無。
import "server-only";
import type { Clock } from "@/lib/clock";
import { addServiceDays, serviceDateOf, serviceDateToDbDate } from "@/lib/time";
import type { HealthErrorResponse, HealthResponse } from "@/lib/api-schemas/health";
import type { Db } from "./client";
import { getLastCollectedAt } from "./live";

/** そのジョブが、ある時刻以降に一度でも成功しているか（collector_runs） */
export async function hasJobSucceededSince(db: Db, job: string, since: Date): Promise<boolean> {
  const run = await db.collectorRun.findFirst({
    where: { job, status: "success", startedAt: { gte: since } },
    select: { id: true },
  });
  return run !== null;
}

export type HealthResult =
  { ok: true; body: HealthResponse } | { ok: false; body: HealthErrorResponse; error: unknown };

export async function checkHealth(db: Db, clock: Clock): Promise<HealthResult> {
  const now = clock.now();
  const previousServiceDate = addServiceDays(serviceDateOf(now), -1);
  try {
    const [lastCollectedAt, aggregate] = await Promise.all([
      getLastCollectedAt(db),
      db.aggregateRun.findUnique({
        where: { serviceDate: serviceDateToDbDate(previousServiceDate) },
        select: { status: true },
      }),
    ]);
    return {
      ok: true,
      body: {
        status: "ok",
        checkedAt: now.toISOString(),
        lastCollectedAt: lastCollectedAt?.toISOString() ?? null,
        previousServiceDate,
        previousServiceDateAggregated: aggregate?.status === "success",
      },
    };
  } catch (error) {
    return { ok: false, body: { status: "error", checkedAt: now.toISOString() }, error };
  }
}
