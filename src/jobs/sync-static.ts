// sync-static: 路線・駅・路線パターンを毎日同期し、未知の駅 ID を解決する（specs/001-data-collection、US4）
// 起動: pnpm job:sync-static（Cloud Run Job では Cloud Scheduler が毎日 04:00 ET に起動する）
import { pathToFileURL } from "node:url";
import { systemClock, type Clock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { requireDatabaseUrl } from "@/lib/db/connection";
import {
  markStopIdsResolved,
  replaceRoutePatterns,
  upsertRoutes,
  upsertStops,
} from "@/lib/db/static";
import { logger } from "@/lib/log";
import { mbtaClientFromEnv, type MbtaClient } from "@/lib/mbta/client";
import { fetchStatic } from "@/lib/mbta/static";
import { runJob, type JobOutcome, type JobRunResult } from "./runner";

export interface SyncStaticDeps {
  db: Db;
  client: MbtaClient;
  clock: Clock;
  connectionString: string;
}

/** 1 回分の同期。取得がすべて成功したときだけ、1 つのトランザクションで書き込む */
export async function syncStatic({
  db,
  client,
  clock,
}: Omit<SyncStaticDeps, "connectionString">): Promise<JobOutcome> {
  const unresolved = (
    await db.unknownStopId.findMany({ where: { resolvedAt: null }, select: { stopId: true } })
  ).map((u) => u.stopId);
  const snapshot = await fetchStatic(client, unresolved);
  if (snapshot.rejectedRows > 0) {
    logger.warn("スキーマに合わない行をスキップしました", {
      job: "sync-static",
      rejectedRows: snapshot.rejectedRows,
    });
  }

  await db.$transaction(
    async (tx) => {
      await upsertRoutes(tx, snapshot.routes);
      await upsertStops(tx, snapshot.stops);
      await replaceRoutePatterns(tx, snapshot.routePatterns);
      await markStopIdsResolved(tx, snapshot.resolvedStopIds, clock.now());
    },
    { timeout: 30_000 },
  );

  const stillUnknown = unresolved.filter((id) => !snapshot.resolvedStopIds.includes(id));
  if (stillUnknown.length > 0) {
    logger.warn("解決できない駅 ID があります", {
      job: "sync-static",
      unresolvedStopIds: stillUnknown.slice(0, 50),
    });
  }
  return {
    counts: {
      requests: client.requestCount,
      routes: snapshot.routes.length,
      stops: snapshot.stops.length,
      routePatterns: snapshot.routePatterns.length,
      resolvedStopIds: snapshot.resolvedStopIds.length,
      unresolvedStopIds: stillUnknown.length,
      rejectedRows: snapshot.rejectedRows,
    },
    ratelimitRemaining: client.lastRateLimit?.remaining ?? null,
  };
}

export function runSyncStatic(deps: SyncStaticDeps): Promise<JobRunResult> {
  return runJob("sync-static", deps, () => syncStatic(deps));
}

async function main(): Promise<void> {
  const connectionString = requireDatabaseUrl();
  const db = createDb(connectionString);
  try {
    const result = await runSyncStatic({
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
