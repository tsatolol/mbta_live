// 分析の内部 API（003）の共通部分: 期間（from / to）の検証、今日を含むかの判定、応答の共通の項目。
// 各 API は、範囲のうち今日より前を集計テーブルから、今日の分を生データから同じ SQL で計算して結合する
import "server-only";
import { z } from "zod";
import type { Clock } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { getLastAggregatedServiceDate, listSuccessfulAggregateRuns } from "@/lib/db/analytics-read";
import { AGGREGATE_DEFINITION_VERSION } from "@/lib/metrics/constants";
import { serviceDateOf, type ServiceDate } from "@/lib/time";
import { serviceDateSchema, type AnalyticsMeta } from "@/lib/api-schemas/analytics";
import {
  aggregatedPart,
  groupDefinitionVersions,
  includesToday,
  resolveAnalyticsRange,
  type ServiceDateRange,
} from "./analytics-params";
import { errorResponse, liveMeta } from "./handler";

/** 分析 API の共通のクエリパラメータ（期間） */
export const rangeQuerySchema = z.object({
  from: serviceDateSchema.optional(),
  to: serviceDateSchema.optional(),
});

export interface AnalyticsContext {
  today: ServiceDate;
  range: ServiceDateRange;
  /** 集計テーブルから読む部分（今日より前）。なければ null */
  aggregated: ServiceDateRange | null;
  /** 今日の分を生データから計算するか */
  todayIncluded: boolean;
}

/** 期間を決める。不正なら 400 の応答を返す */
export function analyticsContext(
  clock: Clock,
  input: { from?: ServiceDate; to?: ServiceDate },
): { ok: true; ctx: AnalyticsContext } | { ok: false; response: ReturnType<typeof errorResponse> } {
  const today = serviceDateOf(clock.now());
  const resolved = resolveAnalyticsRange(input, today);
  if (!resolved.ok) {
    return {
      ok: false,
      response: errorResponse(400, `Invalid query parameter: ${resolved.error}`),
    };
  }
  return {
    ok: true,
    ctx: {
      today,
      range: resolved.range,
      aggregated: aggregatedPart(resolved.range, today),
      todayIncluded: includesToday(resolved.range, today),
    },
  };
}

/** 応答の共通の項目: lastCollectedAt / generatedAt、期間、今日を含むか、集計の状況、定義の版 */
export async function analyticsMeta(
  db: Db,
  clock: Clock,
  ctx: AnalyticsContext,
): Promise<AnalyticsMeta> {
  const [meta, lastAggregated, runs] = await Promise.all([
    liveMeta(db, clock),
    getLastAggregatedServiceDate(db),
    ctx.aggregated
      ? listSuccessfulAggregateRuns(db, ctx.aggregated.from, ctx.aggregated.to)
      : Promise.resolve([]),
  ]);
  const days = ctx.todayIncluded
    ? [...runs, { serviceDate: ctx.today, version: AGGREGATE_DEFINITION_VERSION }]
    : runs;
  return {
    ...meta,
    from: ctx.range.from,
    to: ctx.range.to,
    todayIncluded: ctx.todayIncluded,
    lastAggregatedServiceDate: lastAggregated,
    definitionVersions: groupDefinitionVersions(days),
  };
}
