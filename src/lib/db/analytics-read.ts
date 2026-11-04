// 分析（003）の内部 API が読むクエリ。集計テーブルと aggregate_runs を読むだけ（Web は読み取り専用。憲章）
import "server-only";
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
