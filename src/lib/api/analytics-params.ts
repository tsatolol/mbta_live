// 分析 API の期間の解釈（純粋関数。単体テストする）。今日は呼ぶ側が時計から求めて渡す
import { ANALYTICS_DEFAULT_RANGE_DAYS, ANALYTICS_MAX_RANGE_DAYS } from "@/lib/metrics/constants";
import { addServiceDays, type ServiceDate } from "@/lib/time";

export interface ServiceDateRange {
  from: ServiceDate;
  to: ServiceDate;
}

export type RangeResult = { ok: true; range: ServiceDateRange } | { ok: false; error: string };

/**
 * 期間を決める。to の既定は今日、from の既定は to を含めて ANALYTICS_DEFAULT_RANGE_DAYS 日前。
 * from > to、今日より後の to、ANALYTICS_MAX_RANGE_DAYS 日より長い期間はエラー
 */
export function resolveAnalyticsRange(
  input: { from?: ServiceDate; to?: ServiceDate },
  today: ServiceDate,
): RangeResult {
  const to = input.to ?? today;
  const from = input.from ?? addServiceDays(to, -(ANALYTICS_DEFAULT_RANGE_DAYS - 1));
  if (from > to) return { ok: false, error: "from must not be after to" };
  if (to > today) return { ok: false, error: `to must not be after today (${today})` };
  if (addServiceDays(from, ANALYTICS_MAX_RANGE_DAYS - 1) < to) {
    return { ok: false, error: `the range must be ${ANALYTICS_MAX_RANGE_DAYS} days or shorter` };
  }
  return { ok: true, range: { from, to } };
}

/** 範囲に今日（まだ集計されていない運行日）が含まれるか */
export function includesToday(range: ServiceDateRange, today: ServiceDate): boolean {
  return range.from <= today && today <= range.to;
}

/** 範囲のうち、集計テーブルから読む部分（今日より前）。なければ null */
export function aggregatedPart(
  range: ServiceDateRange,
  today: ServiceDate,
): ServiceDateRange | null {
  const to = range.to < today ? range.to : addServiceDays(today, -1);
  return range.from <= to ? { from: range.from, to } : null;
}

/** 運行日ごとの定義の版を、連続する同じ版の区間にまとめる（運行日の古い順に渡す） */
export function groupDefinitionVersions(
  days: readonly { serviceDate: ServiceDate; version: number }[],
): { version: number; from: ServiceDate; to: ServiceDate }[] {
  const out: { version: number; from: ServiceDate; to: ServiceDate }[] = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && last.version === d.version && addServiceDays(last.to, 1) === d.serviceDate) {
      last.to = d.serviceDate;
    } else {
      out.push({ version: d.version, from: d.serviceDate, to: d.serviceDate });
    }
  }
  return out;
}
