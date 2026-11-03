// ジョブの共通部分: 実行記録（collector_runs）、多重起動の防止（advisory lock）、終了コード。
import pg from "pg";
import type { Db } from "@/lib/db/client";
import type { Clock } from "@/lib/clock";
import { RateLimitedError, MbtaHttpError } from "@/lib/mbta/client";
import { errorFields, logger } from "@/lib/log";

export type JobName = "collect" | "sync-static" | "aggregate";

/** advisory lock のキー（ジョブごとに固定） */
export const JOB_LOCK_KEYS: Readonly<Record<JobName, number>> = {
  collect: 41_001,
  "sync-static": 41_002,
  aggregate: 41_003,
};

export type JobStatus = "running" | "success" | "failed" | "skipped";

export interface JobOutcome {
  counts?: Record<string, number>;
  /** 終了ログに足す項目（監視のログベースの指標で使う。counts のような件数ではないもの） */
  logFields?: Record<string, string | number | boolean>;
  ratelimitRemaining?: number | null;
}

export interface JobDeps {
  db: Db;
  clock: Clock;
  /** advisory lock 用の専用接続に使う接続文字列 */
  connectionString: string;
}

export interface JobRunResult {
  runId: number;
  status: Exclude<JobStatus, "running">;
  exitCode: number;
}

type LockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * advisory lock を取れたときだけ fn を実行する。取れなければすぐ { acquired: false } を返す。
 * セッション単位のロックなので、Prisma の接続プールとは別の専用接続で取る。
 */
export async function withAdvisoryLock<T>(
  connectionString: string,
  key: number,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [key],
    );
    if (!res.rows[0]?.locked) return { acquired: false };
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    await client.end();
  }
}

/**
 * ジョブを実行し、結果を collector_runs に記録する。
 * - 他の回が動いていれば skipped（終了コード 0）
 * - 例外は failed（終了コード 1）。429 のときはレート制限の残量も記録する
 */
export async function runJob(
  name: JobName,
  deps: JobDeps,
  fn: () => Promise<JobOutcome>,
): Promise<JobRunResult> {
  const { db, clock } = deps;
  const run = await db.collectorRun.create({
    data: { job: name, startedAt: clock.now(), status: "running" },
  });

  let status: JobRunResult["status"];
  let outcome: JobOutcome = {};
  let error: string | null = null;
  try {
    const locked = await withAdvisoryLock(deps.connectionString, JOB_LOCK_KEYS[name], fn);
    if (locked.acquired) {
      status = "success";
      outcome = locked.value;
    } else {
      status = "skipped";
    }
  } catch (e) {
    status = "failed";
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (e instanceof MbtaHttpError)
      outcome = { ratelimitRemaining: e.rateLimit?.remaining ?? null };
    if (e instanceof RateLimitedError)
      outcome = { ratelimitRemaining: e.rateLimit?.remaining ?? 0 };
    logger.error(`ジョブ ${name} が失敗しました`, { job: name, ...errorFields(e) });
  }

  await db.collectorRun.update({
    where: { id: run.id },
    data: {
      finishedAt: clock.now(),
      status,
      counts: outcome.counts ?? undefined,
      ratelimitRemaining: outcome.ratelimitRemaining ?? null,
      error,
    },
  });
  // 監視（004 の modules/app/monitoring.tf）のログベースの指標は、この終了ログの job・status・counts・
  // logFields の項目を読む。項目の名前を変えるときは monitoring.tf も直す
  logger.info(`ジョブ ${name} が終了しました`, {
    ...(outcome.logFields ?? {}),
    job: name,
    status,
    counts: outcome.counts ?? {},
    ratelimitRemaining: outcome.ratelimitRemaining ?? null,
  });
  return { runId: run.id, status, exitCode: status === "failed" ? 1 : 0 };
}
