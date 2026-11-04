// 分析（003）の集計 SQL。指標ごとに「運行日 1 つ分の集計の行を返す SELECT」を 1 つだけ持ち、
// aggregate ジョブ（集計テーブルへの INSERT）と分析 API（今日の分の計算）の両方で使う
// （specs/003-analytics/research.md）。定義は data-model.md、TypeScript 版は src/lib/metrics/。
// SQL を変えたら、TypeScript 版との突き合わせのテスト（tests/integration/analytics/）を必ず通す
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import {
  BUNCHING_THRESHOLD_SEC,
  GAP_BASELINE_DAYS,
  GAP_MULTIPLIER,
  MAX_HEADWAY_SEC,
  PREDICTION_WITHIN_SEC,
} from "@/lib/metrics/constants";
import { GREEN_BRANCHES, GREEN_COMBINED } from "@/lib/metrics/headways";
import { UNKNOWN_UPDATE_TYPE } from "@/lib/metrics/prediction-accuracy";
import { BOSTON_TZ, serviceDateToDbDate, type ServiceDate } from "@/lib/time";
import type { DbLike } from "./types";

/** 曜日種別（src/lib/time.ts の dayTypeOf と同じ。date 型の式を受け取る） */
function dayTypeSql(dateExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE EXTRACT(DOW FROM ${dateExpr})
    WHEN 0 THEN 'sunday' WHEN 6 THEN 'saturday' ELSE 'weekday' END)`;
}

/**
 * Green の 2 つ以上の支線が通る親駅（幹線）。典型的な路線パターン（canonical か typicality 1）から求める
 */
export const greenTrunkStopsSql = Prisma.sql`
  SELECT s."station" AS "stop_id"
  FROM "route_patterns" p, jsonb_array_elements_text(p."station_ids") AS s("station")
  WHERE p."route_id" IN (${Prisma.join([...GREEN_BRANCHES])})
    AND (p."canonical" OR p."typicality" = 1)
  GROUP BY s."station"
  HAVING count(DISTINCT p."route_id") >= 2`;

/**
 * 運行間隔の統計（運行日 1 つ分）。列は daily_headway_stats と同じ（service_date を除く）。
 * - 同じ (路線, 方向, 親駅) の到着を時刻の順に並べ、lag で直前の到着との差をとる
 * - MAX_HEADWAY_SEC より長い間隔は除く。時間帯は後の到着の ET の時
 * - Green の幹線の駅では、4 支線をまとめた route_id = Green も計算する
 * - 間隔の開きの基準は、前の GAP_BASELINE_DAYS 日のうち同じ曜日種別の日の p50 の中央値（daily_headway_stats）
 */
export function headwayStatsSql(serviceDate: ServiceDate): Prisma.Sql {
  const d = serviceDateToDbDate(serviceDate);
  return Prisma.sql`
    WITH "trunk" AS (${greenTrunkStopsSql}),
    "arr" AS (
      SELECT "route_id", "direction_id", "stop_id", "arrived_at"
      FROM "arrival_events" WHERE "service_date" = ${d}::date
      UNION ALL
      SELECT ${GREEN_COMBINED}::text, "direction_id", "stop_id", "arrived_at"
      FROM "arrival_events"
      WHERE "service_date" = ${d}::date
        AND "route_id" IN (${Prisma.join([...GREEN_BRANCHES])})
        AND "stop_id" IN (SELECT "stop_id" FROM "trunk")
    ),
    "hw" AS (
      SELECT "route_id", "direction_id", "stop_id", "arrived_at",
        EXTRACT(EPOCH FROM "arrived_at" - lag("arrived_at") OVER (
          PARTITION BY "route_id", "direction_id", "stop_id" ORDER BY "arrived_at"
        ))::float8 AS "sec"
      FROM "arr"
    ),
    "valid" AS (
      SELECT "route_id", "direction_id", "stop_id", "sec",
        EXTRACT(HOUR FROM "arrived_at" AT TIME ZONE ${BOSTON_TZ})::int AS "hour"
      FROM "hw"
      WHERE "sec" IS NOT NULL AND "sec" <= ${MAX_HEADWAY_SEC}
    ),
    "baseline" AS (
      SELECT "route_id", "direction_id", "stop_id", "hour"::int AS "hour",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY "p50_sec") AS "median"
      FROM "daily_headway_stats"
      WHERE "service_date" >= ${d}::date - ${GAP_BASELINE_DAYS}::int
        AND "service_date" < ${d}::date
        AND ${dayTypeSql(Prisma.sql`"service_date"`)} = ${dayTypeSql(Prisma.sql`${d}::date`)}
      GROUP BY "route_id", "direction_id", "stop_id", "hour"
    )
    SELECT v."route_id", v."direction_id", v."stop_id", v."hour",
      count(*)::int AS "n",
      avg(v."sec") AS "mean_sec",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY v."sec") AS "p50_sec",
      percentile_cont(0.9) WITHIN GROUP (ORDER BY v."sec") AS "p90_sec",
      round(max(v."sec"))::int AS "max_sec",
      (count(*) FILTER (WHERE v."sec" < ${BUNCHING_THRESHOLD_SEC}))::int AS "bunching_count",
      (count(*) FILTER (
        WHERE b."median" IS NOT NULL AND v."sec" > b."median" * ${GAP_MULTIPLIER}
      ))::int AS "gap_count"
    FROM "valid" v
    LEFT JOIN "baseline" b
      ON b."route_id" = v."route_id" AND b."direction_id" = v."direction_id"
      AND b."stop_id" = v."stop_id" AND b."hour" = v."hour"
    GROUP BY v."route_id", v."direction_id", v."stop_id", v."hour"
    ORDER BY v."route_id", v."direction_id", v."stop_id", v."hour"`;
}

export const headwayStatSqlRowSchema = z.object({
  route_id: z.string(),
  direction_id: z.number().int(),
  stop_id: z.string(),
  hour: z.number().int(),
  n: z.number().int(),
  mean_sec: z.number(),
  p50_sec: z.number(),
  p90_sec: z.number(),
  max_sec: z.number().int(),
  bunching_count: z.number().int(),
  gap_count: z.number().int(),
});
export type HeadwayStatSqlRow = z.infer<typeof headwayStatSqlRowSchema>;

/** 運行間隔の統計を計算する（運行日 1 つ分。書き込まない） */
export async function computeHeadwayStats(
  db: DbLike,
  serviceDate: ServiceDate,
): Promise<HeadwayStatSqlRow[]> {
  const rows = await db.$queryRaw<unknown[]>(headwayStatsSql(serviceDate));
  return z.array(headwayStatSqlRowSchema).parse(rows);
}

/** 運行間隔の統計を daily_headway_stats に入れる（その運行日の行は呼ぶ側が先に消す）。入れた行数を返す */
export async function insertHeadwayStats(db: DbLike, serviceDate: ServiceDate): Promise<number> {
  const d = serviceDateToDbDate(serviceDate);
  return db.$executeRaw`
    INSERT INTO "daily_headway_stats" ("service_date", "route_id", "direction_id", "stop_id", "hour",
      "n", "mean_sec", "p50_sec", "p90_sec", "max_sec", "bunching_count", "gap_count")
    SELECT ${d}::date, x."route_id", x."direction_id", x."stop_id", x."hour",
      x."n", x."mean_sec", x."p50_sec", x."p90_sec", x."max_sec", x."bunching_count", x."gap_count"
    FROM (${headwayStatsSql(serviceDate)}) x`;
}

/**
 * 到着予測の精度（運行日 1 つ分）。列は daily_prediction_accuracy と同じ（service_date を除く）。
 * - 予測サンプルを (運行日, 便, 親駅) で到着と突き合わせる。補間（interpolated）の到着は除く
 * - 誤差 = 実際の到着 − 予測した到着（正 = 予測より遅く到着）。時間帯は実際の到着の ET の時
 */
export function predictionAccuracySql(serviceDate: ServiceDate): Prisma.Sql {
  const d = serviceDateToDbDate(serviceDate);
  return Prisma.sql`
    WITH "e" AS (
      SELECT p."route_id", p."direction_id", p."lead_bucket_min"::int AS "lead_bucket_min",
        COALESCE(p."update_type", ${UNKNOWN_UPDATE_TYPE}) AS "update_type",
        EXTRACT(HOUR FROM a."arrived_at" AT TIME ZONE ${BOSTON_TZ})::int AS "hour",
        EXTRACT(EPOCH FROM a."arrived_at" - p."predicted_arrival_at")::float8 AS "err"
      FROM "prediction_samples" p
      JOIN "arrival_events" a
        ON a."service_date" = p."service_date" AND a."trip_id" = p."trip_id"
        AND a."stop_id" = p."stop_id"
      WHERE p."service_date" = ${d}::date AND a."service_date" = ${d}::date
        AND a."source" <> 'interpolated'
    )
    SELECT "route_id", "direction_id", "lead_bucket_min", "update_type", "hour",
      count(*)::int AS "n",
      avg("err") AS "mean_error_sec",
      avg(abs("err")) AS "mean_abs_error_sec",
      percentile_cont(0.9) WITHIN GROUP (ORDER BY abs("err")) AS "p90_abs_error_sec",
      (count(*) FILTER (WHERE abs("err") <= ${PREDICTION_WITHIN_SEC}))::float8 / count(*) AS "within_60s_ratio"
    FROM "e"
    GROUP BY "route_id", "direction_id", "lead_bucket_min", "update_type", "hour"
    ORDER BY "route_id", "direction_id", "lead_bucket_min", "update_type", "hour"`;
}

export const predictionAccuracySqlRowSchema = z.object({
  route_id: z.string(),
  direction_id: z.number().int(),
  lead_bucket_min: z.number().int(),
  update_type: z.string(),
  hour: z.number().int(),
  n: z.number().int(),
  mean_error_sec: z.number(),
  mean_abs_error_sec: z.number(),
  p90_abs_error_sec: z.number(),
  within_60s_ratio: z.number(),
});
export type PredictionAccuracySqlRow = z.infer<typeof predictionAccuracySqlRowSchema>;

/** 到着予測の精度を計算する（運行日 1 つ分。書き込まない） */
export async function computePredictionAccuracy(
  db: DbLike,
  serviceDate: ServiceDate,
): Promise<PredictionAccuracySqlRow[]> {
  const rows = await db.$queryRaw<unknown[]>(predictionAccuracySql(serviceDate));
  return z.array(predictionAccuracySqlRowSchema).parse(rows);
}

/** 到着予測の精度を daily_prediction_accuracy に入れる。入れた行数を返す */
export async function insertPredictionAccuracy(
  db: DbLike,
  serviceDate: ServiceDate,
): Promise<number> {
  const d = serviceDateToDbDate(serviceDate);
  return db.$executeRaw`
    INSERT INTO "daily_prediction_accuracy" ("service_date", "route_id", "direction_id",
      "lead_bucket_min", "update_type", "hour", "n", "mean_error_sec", "mean_abs_error_sec",
      "p90_abs_error_sec", "within_60s_ratio")
    SELECT ${d}::date, x."route_id", x."direction_id", x."lead_bucket_min", x."update_type", x."hour",
      x."n", x."mean_error_sec", x."mean_abs_error_sec", x."p90_abs_error_sec", x."within_60s_ratio"
    FROM (${predictionAccuracySql(serviceDate)}) x`;
}
