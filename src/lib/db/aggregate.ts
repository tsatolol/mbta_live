// 日次集計（003）の書き込み。1 つの運行日を 1 つのトランザクションで「その日の行を消す → 指標ごとに入れ直す →
// aggregate_runs を記録する」。同じ運行日を何度集計しても結果は同じ（specs/003-analytics/research.md の「集計の冪等性」）
import type { ServiceDate } from "@/lib/time";
import { serviceDateToDbDate } from "@/lib/time";
import { AGGREGATE_DEFINITION_VERSION } from "@/lib/metrics/constants";
import { insertHeadwayStats, insertPredictionAccuracy } from "./analytics-sql";
import type { Db } from "./client";
import type { DbTx } from "./types";

/** 集計テーブル（aggregate ジョブだけが書く） */
export const AGGREGATE_TABLES = [
  "daily_headway_stats",
  "daily_prediction_accuracy",
  "daily_alert_stats",
  "hourly_alert_minutes",
] as const;
export type AggregateTable = (typeof AGGREGATE_TABLES)[number];

/** 指標ごとの集計。運行日 1 つ分の行を、自分の集計テーブルに入れて、入れた行数を返す */
export interface MetricAggregator {
  name: string;
  /** この集計が書くテーブル（集計の前に、その運行日の行を消す） */
  tables: readonly AggregateTable[];
  run(tx: DbTx, serviceDate: ServiceDate): Promise<number>;
}

/**
 * 登録済みの指標の集計。各ユーザーストーリーで足す（運行間隔 → 予測精度 → アラート）。
 * 3 つがそろったら AGGREGATE_DEFINITION_VERSION を 1 にする
 */
export const METRIC_AGGREGATORS: readonly MetricAggregator[] = [
  { name: "headways", tables: ["daily_headway_stats"], run: insertHeadwayStats },
  {
    name: "predictionAccuracy",
    tables: ["daily_prediction_accuracy"],
    run: insertPredictionAccuracy,
  },
];

/** 1 日分の集計にかかる時間の上限（トランザクションのタイムアウト） */
const AGGREGATE_TX_TIMEOUT_MS = 5 * 60_000;

/** 運行日 1 つを集計する。指標ごとに入れた行数を返す */
export async function aggregateServiceDate(
  db: Db,
  serviceDate: ServiceDate,
  finishedAt: Date,
  aggregators: readonly MetricAggregator[] = METRIC_AGGREGATORS,
): Promise<Record<string, number>> {
  const date = serviceDateToDbDate(serviceDate);
  return db.$transaction(
    async (tx) => {
      const rows: Record<string, number> = {};
      for (const aggregator of aggregators) {
        for (const table of aggregator.tables) {
          // テーブル名は AGGREGATE_TABLES の定数だけ
          await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "service_date" = $1`, date);
        }
        rows[aggregator.name] = await aggregator.run(tx, serviceDate);
      }
      await tx.aggregateRun.upsert({
        where: { serviceDate: date },
        create: {
          serviceDate: date,
          status: "success",
          finishedAt,
          definitionVersion: AGGREGATE_DEFINITION_VERSION,
        },
        update: { status: "success", finishedAt, definitionVersion: AGGREGATE_DEFINITION_VERSION },
      });
      return rows;
    },
    { timeout: AGGREGATE_TX_TIMEOUT_MS, maxWait: 30_000 },
  );
}

/**
 * 集計に失敗した運行日を記録する。前に成功していた運行日でも failed にする（集計テーブルの行は
 * トランザクションが戻るので前回のまま残るが、今の定義で集計できていないことを残す）
 */
export async function recordAggregateFailure(
  db: Db,
  serviceDate: ServiceDate,
  finishedAt: Date,
): Promise<void> {
  const date = serviceDateToDbDate(serviceDate);
  await db.aggregateRun.upsert({
    where: { serviceDate: date },
    create: {
      serviceDate: date,
      status: "failed",
      finishedAt,
      definitionVersion: AGGREGATE_DEFINITION_VERSION,
    },
    update: { status: "failed", finishedAt, definitionVersion: AGGREGATE_DEFINITION_VERSION },
  });
}
