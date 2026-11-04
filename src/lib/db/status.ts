// 稼働状況（002 US4、GET /api/status）のクエリ: ジョブの実行結果、レート制限の残量、テーブルの行数。DB を読むだけ
import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "./client";

/** 稼働状況に出すジョブ（001 / 003 の Cloud Run Jobs） */
export const STATUS_JOBS = ["collect", "sync-static", "aggregate"] as const;

export interface JobRunRow {
  job: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  counts: Record<string, number> | null;
  error: string | null;
}

/** counts 列（JSON）のうち、数値の項目だけを読む */
export function numericCounts(value: unknown): Record<string, number> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

export interface JobSummary {
  job: string;
  recentRuns: JobRunRow[];
  lastSuccessAt: Date | null;
  runsSince: number;
  failedSince: number;
}

/** ジョブの直近の実行（新しい順に limit 件）、最後の成功、since 以降の実行と失敗の数 */
export async function summarizeJob(
  db: Db,
  job: string,
  since: Date,
  limit: number,
): Promise<JobSummary> {
  const [runs, lastSuccess, grouped] = await Promise.all([
    db.collectorRun.findMany({
      where: { job },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
    db.collectorRun.findFirst({
      where: { job, status: "success" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true, startedAt: true },
    }),
    db.collectorRun.groupBy({
      by: ["status"],
      where: { job, startedAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);
  return {
    job,
    recentRuns: runs.map((r) => ({
      job: r.job,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      counts: numericCounts(r.counts),
      error: r.error,
    })),
    lastSuccessAt: lastSuccess ? (lastSuccess.finishedAt ?? lastSuccess.startedAt) : null,
    runsSince: grouped.reduce((sum, g) => sum + g._count._all, 0),
    failedSince: grouped
      .filter((g) => g.status === "failed")
      .reduce((sum, g) => sum + g._count._all, 0),
  };
}

/** 最後の collector の実行で見た MBTA API のレート制限の残量 */
export async function getRateLimitRemaining(db: Db): Promise<number | null> {
  const run = await db.collectorRun.findFirst({
    where: { job: "collect", ratelimitRemaining: { not: null } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { ratelimitRemaining: true },
  });
  return run?.ratelimitRemaining ?? null;
}

/** 正確に数える小さなテーブル */
const EXACT_TABLES = [
  "routes",
  "stops",
  "route_patterns",
  "vehicles_current",
  "predictions_current",
  "alerts",
  "alert_routes",
  "collector_runs",
  "unknown_stop_ids",
  "aggregate_runs",
] as const;

/** パーティションに分かれた大きな履歴テーブル（推定値） */
const PARTITIONED_TABLES = ["vehicle_positions", "prediction_samples", "arrival_events"] as const;

export interface TableRowCount {
  name: string;
  rows: number;
  estimated: boolean;
}

/**
 * テーブルごとの行数。小さなテーブルは count(*)。パーティションに分かれた履歴テーブルは、
 * 各パーティションの pg_class.reltuples（ANALYZE の推定値）の合計にする。
 * まだ ANALYZE されていない（reltuples が -1 の）パーティションだけは数える（作られたばかりで小さい）
 */
export async function countTableRows(db: Db): Promise<TableRowCount[]> {
  const exact = await db.$queryRaw<{ name: string; rows: bigint }[]>(
    Prisma.sql`${Prisma.join(
      EXACT_TABLES.map(
        (t) =>
          Prisma.sql`SELECT ${t}::text AS "name", count(*) AS "rows" FROM ${Prisma.raw(`"${t}"`)}`,
      ),
      " UNION ALL ",
    )}`,
  );
  // パーティション（relkind 'r'。パーティションに分かれたインデックスも pg_inherits に入るので除く）
  const partitions = await db.$queryRaw<
    { parent: string; schema: string; child: string; reltuples: number }[]
  >`
    SELECT parent.relname AS "parent", cn.nspname AS "schema", child.relname AS "child",
           child.reltuples::float8 AS "reltuples"
      FROM pg_inherits i
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace pn ON pn.oid = parent.relnamespace
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_namespace cn ON cn.oid = child.relnamespace
     WHERE pn.nspname = current_schema()
       AND child.relkind = 'r'
       AND parent.relname IN (${Prisma.join([...PARTITIONED_TABLES])})`;

  const partitioned: TableRowCount[] = [];
  for (const table of PARTITIONED_TABLES) {
    let rows = 0;
    let estimated = false;
    for (const p of partitions.filter((x) => x.parent === table)) {
      if (p.reltuples >= 0) {
        rows += Math.round(p.reltuples);
        estimated = true;
      } else {
        const [counted] = await db.$queryRaw<{ rows: bigint }[]>(
          Prisma.sql`SELECT count(*) AS "rows" FROM ${Prisma.raw(`"${p.schema}"."${p.child}"`)}`,
        );
        rows += Number(counted?.rows ?? 0);
      }
    }
    partitioned.push({ name: table, rows, estimated });
  }
  return [
    ...EXACT_TABLES.map((name) => ({
      name,
      rows: Number(exact.find((e) => e.name === name)?.rows ?? 0),
      estimated: false,
    })),
    ...partitioned,
  ];
}
