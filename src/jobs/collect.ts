// collector: 車両・予測・アラートを取得し、現在値と履歴を保存する（specs/001-data-collection、US1）
// 起動: pnpm job:collect（Cloud Run Job では Cloud Scheduler が prod 1 分 / dev 5 分ごとに起動する）
import { pathToFileURL } from "node:url";
import { systemClock, type Clock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { requireDatabaseUrl } from "@/lib/db/connection";
import { insertVehiclePositions } from "@/lib/db/history";
import { replaceCurrent } from "@/lib/db/current";
import { upsertAlerts } from "@/lib/db/alerts";
import { ensurePartitions } from "@/lib/db/partitions";
import { logger } from "@/lib/log";
import { mbtaClientFromEnv, type MbtaClient } from "@/lib/mbta/client";
import { fetchRealtime } from "@/lib/mbta/realtime";
import { addServiceDays, serviceDateOf } from "@/lib/time";
import { runJob, type JobOutcome, type JobRunResult } from "./runner";

export interface CollectDeps {
  db: Db;
  client: MbtaClient;
  clock: Clock;
  connectionString: string;
}

/** 書き込みのトランザクションの上限（予測が数千件でも十分な長さ。Job のタイムアウトは 50 秒） */
const TX_TIMEOUT_MS = 30_000;

/** 1 回分の収集。ロックや実行記録は runCollect が行う */
export async function collect({
  db,
  client,
  clock,
}: Omit<CollectDeps, "connectionString">): Promise<JobOutcome> {
  const polledAt = clock.now();
  const today = serviceDateOf(polledAt);
  // 前日（03:00 直後に前日の updated_at を持つ車両がいる）から明日まで
  const serviceDates = [addServiceDays(today, -1), today, addServiceDays(today, 1)];
  await ensurePartitions(db, serviceDates);

  const snapshot = await fetchRealtime(client);
  const rejectedRows =
    snapshot.rejected.vehicles.length +
    snapshot.rejected.predictions.length +
    snapshot.rejected.alerts.length;
  if (rejectedRows > 0) {
    logger.warn("スキーマに合わない行をスキップしました", {
      job: "collect",
      rejected: snapshot.rejected,
    });
  }

  // パーティションのない運行日（数日前から更新の止まった車両など）の位置は履歴に入れない
  const knownDates = new Set(serviceDates);
  const positions = snapshot.vehicles.filter((v) => knownDates.has(serviceDateOf(v.updatedAt)));

  const positionsInserted = await db.$transaction(
    async (tx) => {
      await replaceCurrent(tx, snapshot.vehicles, snapshot.predictions, polledAt);
      await upsertAlerts(tx, snapshot.alerts, polledAt);
      return insertVehiclePositions(tx, positions, polledAt);
    },
    { timeout: TX_TIMEOUT_MS },
  );

  return {
    counts: {
      requests: client.requestCount,
      vehicles: snapshot.vehicles.length,
      predictions: snapshot.predictions.length,
      alerts: snapshot.alerts.length,
      rejectedRows,
      positionsInserted,
      positionsSkipped: snapshot.vehicles.length - positions.length,
    },
    ratelimitRemaining: client.lastRateLimit?.remaining ?? null,
  };
}

/** ロックを取り、実行結果を collector_runs に記録して collect を実行する */
export function runCollect(deps: CollectDeps): Promise<JobRunResult> {
  return runJob("collect", deps, () => collect(deps));
}

async function main(): Promise<void> {
  const connectionString = requireDatabaseUrl();
  const db = createDb(connectionString);
  try {
    const result = await runCollect({
      db,
      client: mbtaClientFromEnv(),
      clock: systemClock,
      connectionString,
    });
    process.exitCode = result.exitCode;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
