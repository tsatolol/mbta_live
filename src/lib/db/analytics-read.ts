// 分析（003）の内部 API が読むクエリ。集計テーブルと aggregate_runs を読むだけ（Web は読み取り専用。憲章）
import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { GREEN_COMBINED } from "@/lib/metrics/headways";
import { serviceDateToDbDate, type ServiceDate } from "@/lib/time";
import type { Db } from "./client";

/** DB の date 列（UTC の 0 時の Date）を運行日の文字列にする */
export function dbDateToServiceDate(value: Date): ServiceDate {
  return value.toISOString().slice(0, 10);
}

/** 範囲内で集計に成功した運行日と定義の版（古い順） */
export async function listSuccessfulAggregateRuns(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
): Promise<{ serviceDate: ServiceDate; version: number }[]> {
  const runs = await db.aggregateRun.findMany({
    where: {
      status: "success",
      serviceDate: { gte: serviceDateToDbDate(from), lte: serviceDateToDbDate(to) },
    },
    orderBy: { serviceDate: "asc" },
    select: { serviceDate: true, definitionVersion: true },
  });
  return runs.map((r) => ({
    serviceDate: dbDateToServiceDate(r.serviceDate),
    version: r.definitionVersion,
  }));
}

/** 最後に集計に成功した運行日 */
export async function getLastAggregatedServiceDate(db: Db): Promise<ServiceDate | null> {
  const run = await db.aggregateRun.findFirst({
    where: { status: "success" },
    orderBy: { serviceDate: "desc" },
    select: { serviceDate: true },
  });
  return run ? dbDateToServiceDate(run.serviceDate) : null;
}

export interface HeadwayFilter {
  routeId: string;
  directionId?: number;
}

export interface HeadwayReadRow {
  serviceDate: ServiceDate;
  directionId: number;
  stopId: string;
  hour: number;
  n: number;
  meanSec: number;
  p50Sec: number;
  p90Sec: number;
  maxSec: number;
  bunchingCount: number;
  gapCount: number;
}

/** 集計済みの運行間隔（daily_headway_stats）を読む */
export async function readHeadwayStats(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  filter: HeadwayFilter,
): Promise<HeadwayReadRow[]> {
  const rows = await db.dailyHeadwayStat.findMany({
    where: {
      serviceDate: { gte: serviceDateToDbDate(from), lte: serviceDateToDbDate(to) },
      routeId: filter.routeId,
      ...(filter.directionId !== undefined ? { directionId: filter.directionId } : {}),
    },
  });
  return rows.map((r) => ({ ...r, serviceDate: dbDateToServiceDate(r.serviceDate) }));
}

/** 親駅の名前 */
export async function stopNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const stops = await db.stop.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(stops.map((s) => [s.id, s.name]));
}

export interface AccuracyFilter {
  routeId?: string;
  directionId?: number;
  updateType?: string;
}

/** 予測精度の行（API がまとめるのに使う次元だけ） */
export interface AccuracyReadRow {
  serviceDate: ServiceDate;
  leadBucketMin: number;
  updateType: string;
  n: number;
  meanErrorSec: number;
  meanAbsErrorSec: number;
  p90AbsErrorSec: number;
  within60sRatio: number;
}

const accuracySummarySchema = z.object({
  service_date: z.date(),
  lead_bucket_min: z.number().int(),
  update_type: z.string(),
  n: z.number().int(),
  mean_error_sec: z.number(),
  mean_abs_error_sec: z.number(),
  p90_abs_error_sec: z.number(),
  within_60s_ratio: z.number(),
});

/**
 * 集計済みの予測精度（daily_prediction_accuracy）を、(運行日, リード時間, 予測の種類) ごとにまとめて読む
 * （路線・方向・時間帯は SQL で件数の重み付きでまとめる。28 日・全路線で 13 万行を読まないため。003 T044）
 */
export async function readPredictionAccuracy(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  filter: AccuracyFilter,
): Promise<AccuracyReadRow[]> {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT "service_date", "lead_bucket_min"::int AS "lead_bucket_min", "update_type",
      sum("n")::int AS "n",
      (sum("mean_error_sec" * "n") / sum("n"))::float8 AS "mean_error_sec",
      (sum("mean_abs_error_sec" * "n") / sum("n"))::float8 AS "mean_abs_error_sec",
      (sum("p90_abs_error_sec" * "n") / sum("n"))::float8 AS "p90_abs_error_sec",
      (sum("within_60s_ratio" * "n") / sum("n"))::float8 AS "within_60s_ratio"
    FROM "daily_prediction_accuracy"
    WHERE "service_date" BETWEEN ${serviceDateToDbDate(from)}::date AND ${serviceDateToDbDate(to)}::date
      ${filter.routeId !== undefined ? Prisma.sql`AND "route_id" = ${filter.routeId}` : Prisma.empty}
      ${filter.directionId !== undefined ? Prisma.sql`AND "direction_id" = ${filter.directionId}` : Prisma.empty}
      ${filter.updateType !== undefined ? Prisma.sql`AND "update_type" = ${filter.updateType}` : Prisma.empty}
    GROUP BY "service_date", "lead_bucket_min", "update_type"
    HAVING sum("n") > 0`;
  return z
    .array(accuracySummarySchema)
    .parse(rows)
    .map((r) => ({
      serviceDate: dbDateToServiceDate(r.service_date),
      leadBucketMin: r.lead_bucket_min,
      updateType: r.update_type,
      n: r.n,
      meanErrorSec: r.mean_error_sec,
      meanAbsErrorSec: r.mean_abs_error_sec,
      p90AbsErrorSec: r.p90_abs_error_sec,
      within60sRatio: r.within_60s_ratio,
    }));
}

export interface AlertStatReadRow {
  serviceDate: ServiceDate;
  effect: string;
  cause: string;
  alertCount: number;
  activeMinutes: number;
}

/** 集計済みのアラートの日次の統計（daily_alert_stats）を読む。routeId は路線か ALL_ROUTES */
export async function readAlertStats(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  routeId: string,
): Promise<AlertStatReadRow[]> {
  const rows = await db.dailyAlertStat.findMany({
    where: {
      serviceDate: { gte: serviceDateToDbDate(from), lte: serviceDateToDbDate(to) },
      routeId,
    },
  });
  return rows.map((r) => ({
    serviceDate: dbDateToServiceDate(r.serviceDate),
    effect: r.effect,
    cause: r.cause,
    alertCount: r.alertCount,
    activeMinutes: r.activeMinutes,
  }));
}

// ---- ヒートマップ（003 US4）: (運行日, 時間帯) ごとに集約して読む ----

const hourlyRowSchema = z.object({
  service_date: z.date(),
  hour: z.number().int(),
  n: z.number(),
  weighted_sum: z.number(),
});

function toWeightedRows(rows: unknown[]) {
  return z
    .array(hourlyRowSchema)
    .parse(rows)
    .map((r) => ({
      serviceDate: dbDateToServiceDate(r.service_date),
      hour: r.hour,
      n: r.n,
      weightedSum: r.weighted_sum,
    }));
}

/**
 * 運行間隔の p90 の、(運行日, 時間帯) ごとの件数と p90 × 件数の合計。
 * 路線を指定しなければ、Green の合算を除いたすべての路線（支線と二重に数えないため）
 */
export async function readHeadwayHourly(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  routeId?: string,
) {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT "service_date", "hour"::int AS "hour", sum("n")::int AS "n",
      sum("p90_sec" * "n")::float8 AS "weighted_sum"
    FROM "daily_headway_stats"
    WHERE "service_date" BETWEEN ${serviceDateToDbDate(from)}::date AND ${serviceDateToDbDate(to)}::date
      AND ${routeId === undefined ? Prisma.sql`"route_id" <> ${GREEN_COMBINED}` : Prisma.sql`"route_id" = ${routeId}`}
    GROUP BY "service_date", "hour"`;
  return toWeightedRows(rows);
}

/** 予測の平均絶対誤差の、(運行日, 時間帯) ごとの件数と平均絶対誤差 × 件数の合計 */
export async function readPredictionHourly(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  routeId?: string,
) {
  const rows = await db.$queryRaw<unknown[]>`
    SELECT "service_date", "hour"::int AS "hour", sum("n")::int AS "n",
      sum("mean_abs_error_sec" * "n")::float8 AS "weighted_sum"
    FROM "daily_prediction_accuracy"
    WHERE "service_date" BETWEEN ${serviceDateToDbDate(from)}::date AND ${serviceDateToDbDate(to)}::date
      ${routeId === undefined ? Prisma.empty : Prisma.sql`AND "route_id" = ${routeId}`}
    GROUP BY "service_date", "hour"`;
  return toWeightedRows(rows);
}

/** 遅延系のアラートが有効だった分数の、(運行日, 時間帯) ごとの値（routeId は路線か ALL_ROUTES） */
export async function readDisruptionMinutesHourly(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  routeId: string,
) {
  const rows = await db.hourlyAlertMinute.findMany({
    where: {
      serviceDate: { gte: serviceDateToDbDate(from), lte: serviceDateToDbDate(to) },
      routeId,
      category: "disruption",
    },
  });
  return rows.map((r) => ({
    serviceDate: dbDateToServiceDate(r.serviceDate),
    hour: r.hour,
    minutes: r.activeMinutes,
  }));
}
