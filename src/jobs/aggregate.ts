// aggregate: 日次集計と、生データのパーティションの管理（specs/003-analytics と specs/001-data-collection の US5）
// 起動: pnpm job:aggregate（Cloud Run Job では Cloud Scheduler が毎日 04:30 ET に起動する）
// いまはパーティションの管理だけを行う。集計は 003-analytics で追加する
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { systemClock, type Clock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { requireDatabaseUrl } from "@/lib/db/connection";
import { dropExpiredPartitions, ensurePartitions } from "@/lib/db/partitions";
import { logger } from "@/lib/log";
import { addServiceDays, serviceDateOf } from "@/lib/time";
import { runJob, type JobOutcome, type JobRunResult } from "./runner";

/** 何日先までパーティションを作っておくか */
export const PARTITION_DAYS_AHEAD = 3;

/** RAW_RETENTION_DAYS が未設定のときの保持日数（prod の値。短くするより長く残すほうを既定にする） */
export const DEFAULT_RAW_RETENTION_DAYS = 28;

export interface AggregateDeps {
  db: Db;
  clock: Clock;
  connectionString: string;
  /** 生データの保持日数（dev 3 / prod 28） */
  retentionDays: number;
}

export async function aggregate({
  db,
  clock,
  retentionDays,
}: Omit<AggregateDeps, "connectionString">): Promise<JobOutcome> {
  const today = serviceDateOf(clock.now());
  const ahead = Array.from({ length: PARTITION_DAYS_AHEAD + 1 }, (_, i) =>
    addServiceDays(today, i),
  );
  await ensurePartitions(db, ahead);

  const retention = await dropExpiredPartitions(db, today, retentionDays);
  if (retention.keptUnaggregated.length > 0) {
    logger.warn("保持期間を過ぎたが集計が済んでいない運行日の生データを残しました", {
      job: "aggregate",
      serviceDates: retention.keptUnaggregated,
    });
  }
  return {
    counts: {
      partitionsEnsured: ahead.length,
      droppedServiceDates: retention.dropped.length,
      keptUnaggregatedServiceDates: retention.keptUnaggregated.length,
    },
  };
}

export function runAggregate(deps: AggregateDeps): Promise<JobRunResult> {
  return runJob("aggregate", deps, () => aggregate(deps));
}

const envSchema = z.object({
  RAW_RETENTION_DAYS: z.coerce.number().int().min(1).default(DEFAULT_RAW_RETENTION_DAYS),
});

async function main(): Promise<void> {
  const { RAW_RETENTION_DAYS } = envSchema.parse({
    RAW_RETENTION_DAYS: process.env.RAW_RETENTION_DAYS || undefined,
  });
  const connectionString = requireDatabaseUrl();
  const db = createDb(connectionString);
  try {
    const result = await runAggregate({
      db,
      clock: systemClock,
      connectionString,
      retentionDays: RAW_RETENTION_DAYS,
    });
    process.exitCode = result.exitCode;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
