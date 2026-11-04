// aggregate: 日次集計と、生データのパーティションの管理（specs/003-analytics と specs/001-data-collection の US5）
// 起動: pnpm job:aggregate（Cloud Run Job では Cloud Scheduler が毎日 04:30 ET に起動する）
//   pnpm job:aggregate                                  前の運行日を集計する
//   pnpm job:aggregate --from 2026-11-01 --to 2026-11-03 期間を指定して再集計する（生データが残っている範囲）
// 順番: パーティションを先に作る → 運行日ごとに集計（古い順）→ 保持期間を過ぎた生データを消す
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { systemClock, type Clock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { requireDatabaseUrl } from "@/lib/db/connection";
import {
  aggregateServiceDate,
  METRIC_AGGREGATORS,
  recordAggregateFailure,
  type MetricAggregator,
} from "@/lib/db/aggregate";
import { dropExpiredPartitions, ensurePartitions } from "@/lib/db/partitions";
import { errorFields, logger } from "@/lib/log";
import { addServiceDays, isServiceDate, serviceDateOf, type ServiceDate } from "@/lib/time";
import { runJob, type JobOutcome, type JobRunResult } from "./runner";

/** 何日先までパーティションを作っておくか */
export const PARTITION_DAYS_AHEAD = 3;

/** RAW_RETENTION_DAYS が未設定のときの保持日数（prod の値。短くするより長く残すほうを既定にする） */
export const DEFAULT_RAW_RETENTION_DAYS = 28;

/** 一度に集計できる運行日の数（--from / --to） */
export const MAX_AGGREGATE_DAYS = 92;

/** 集計する運行日の範囲（両端を含む）。省略時は前の運行日だけ */
export interface AggregateRange {
  from: ServiceDate;
  to: ServiceDate;
}

export interface AggregateDeps {
  db: Db;
  clock: Clock;
  connectionString: string;
  /** 生データの保持日数（dev 3 / prod 28） */
  retentionDays: number;
  range?: AggregateRange;
  /** 指標ごとの集計（テストで差し替える）。既定は登録済みのもの */
  aggregators?: readonly MetricAggregator[];
}

/** 集計する運行日（古い順）。今日（まだ終わっていない運行日）以降は集計しない */
export function serviceDatesToAggregate(today: ServiceDate, range?: AggregateRange): ServiceDate[] {
  if (!range) return [addServiceDays(today, -1)];
  if (range.from > range.to)
    throw new Error(`--from が --to より後です: ${range.from} > ${range.to}`);
  if (range.to >= today) {
    throw new Error(
      `今日（${today}）以降の運行日は、まだ終わっていないので集計できません: ${range.to}`,
    );
  }
  const dates: ServiceDate[] = [];
  for (let d = range.from; d <= range.to; d = addServiceDays(d, 1)) {
    dates.push(d);
    if (dates.length > MAX_AGGREGATE_DAYS) {
      throw new Error(`一度に集計できるのは ${MAX_AGGREGATE_DAYS} 日までです`);
    }
  }
  return dates;
}

export async function aggregate({
  db,
  clock,
  retentionDays,
  range,
  aggregators = METRIC_AGGREGATORS,
}: Omit<AggregateDeps, "connectionString">): Promise<JobOutcome> {
  const today = serviceDateOf(clock.now());
  const dates = serviceDatesToAggregate(today, range);
  const ahead = Array.from({ length: PARTITION_DAYS_AHEAD + 1 }, (_, i) =>
    addServiceDays(today, i),
  );
  await ensurePartitions(db, ahead);

  // 古い順に 1 日ずつ（間隔の開きの基準が、前の日の集計結果を使うため）
  const rowCounts: Record<string, number> = {};
  const failed: { serviceDate: ServiceDate; error: unknown }[] = [];
  for (const serviceDate of dates) {
    try {
      const rows = await aggregateServiceDate(db, serviceDate, clock.now(), aggregators);
      for (const [name, n] of Object.entries(rows)) rowCounts[name] = (rowCounts[name] ?? 0) + n;
      logger.info(`運行日 ${serviceDate} を集計しました`, { job: "aggregate", serviceDate, rows });
    } catch (error) {
      failed.push({ serviceDate, error });
      logger.error(`運行日 ${serviceDate} の集計に失敗しました`, {
        job: "aggregate",
        serviceDate,
        ...errorFields(error),
      });
      await recordAggregateFailure(db, serviceDate, clock.now());
    }
  }

  // 集計が成功した運行日だけ消える（失敗した日は残る）
  const retention = await dropExpiredPartitions(db, today, retentionDays);
  if (retention.keptUnaggregated.length > 0) {
    logger.warn("保持期間を過ぎたが集計が済んでいない運行日の生データを残しました", {
      job: "aggregate",
      serviceDates: retention.keptUnaggregated,
    });
  }
  if (failed.length > 0) {
    // ジョブを失敗にする（runJob が collector_runs に failed を記録し、監視が拾う）
    throw new Error(
      `集計に失敗した運行日があります: ${failed.map((f) => f.serviceDate).join(", ")}`,
    );
  }
  return {
    counts: {
      aggregatedServiceDates: dates.length,
      ...Object.fromEntries(Object.entries(rowCounts).map(([k, v]) => [`${k}Rows`, v])),
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

const serviceDateArg = z.string().refine(isServiceDate, "YYYY-MM-DD の運行日を指定してください");
const argsSchema = z
  .object({ from: serviceDateArg.optional(), to: serviceDateArg.optional() })
  .refine(
    (a) => (a.from === undefined) === (a.to === undefined),
    "--from と --to は両方指定してください",
  );

/** コマンドラインの --from / --to を読む */
export function parseAggregateArgs(argv: readonly string[]): AggregateRange | undefined {
  const { values } = parseArgs({
    args: [...argv],
    options: { from: { type: "string" }, to: { type: "string" } },
    strict: true,
  });
  const parsed = argsSchema.parse(values);
  return parsed.from && parsed.to ? { from: parsed.from, to: parsed.to } : undefined;
}

async function main(): Promise<void> {
  const { RAW_RETENTION_DAYS } = envSchema.parse({
    RAW_RETENTION_DAYS: process.env.RAW_RETENTION_DAYS || undefined,
  });
  const range = parseAggregateArgs(process.argv.slice(2));
  const connectionString = requireDatabaseUrl();
  const db = createDb(connectionString);
  try {
    const result = await runAggregate({
      db,
      clock: systemClock,
      connectionString,
      retentionDays: RAW_RETENTION_DAYS,
      range,
    });
    process.exitCode = result.exitCode;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
