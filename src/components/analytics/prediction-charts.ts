// 予測精度の画面のグラフに渡すデータと表示用の文字列（純粋関数。単体テストする）
import type { PredictionsAnalyticsResponse } from "@/lib/api-schemas/analytics-predictions";
import type { EChartOption } from "@/components/charts/echart";
import { barSeries, baseCartesian, lineSeries } from "@/components/charts/theme";

/** 予測の種類の表示名 */
export const UPDATE_TYPE_LABELS: Record<string, string> = {
  MID_TRIP: "Mid-trip",
  AT_TERMINAL: "At terminal",
  REVERSE_TRIP: "Reverse trip",
  UNKNOWN: "Unknown",
};

export function updateTypeLabel(updateType: string): string {
  return UPDATE_TYPE_LABELS[updateType] ?? updateType;
}

/** リード時間の表示（"5 min"） */
export function leadLabel(min: number): string {
  return `${min} min`;
}

/** 秒（整数に丸める） */
function sec(v: number): number {
  return Math.round(v);
}

/** 割合 → パーセント（小数 1 桁） */
export function percent(ratio: number): number {
  return Math.round(ratio * 1000) / 10;
}

/** バイアス（平均誤差）の表示。正 = 予測より遅く到着 */
export function biasLabel(meanErrorSec: number): string {
  const s = Math.round(meanErrorSec);
  if (s === 0) return "0 s";
  return s > 0 ? `+${s} s (late)` : `${s} s (early)`;
}

/** リード時間ごとの誤差（平均絶対誤差と p90、秒） */
export function errorByLeadOption(res: Pick<PredictionsAnalyticsResponse, "byLead">): EChartOption {
  return {
    ...baseCartesian({
      categories: res.byLead.map((l) => leadLabel(l.leadBucketMin)),
      legend: true,
    }),
    series: [
      barSeries(
        "Mean absolute error",
        res.byLead.map((l) => sec(l.meanAbsErrorSec)),
        0,
      ),
      barSeries(
        "90th percentile",
        res.byLead.map((l) => sec(l.p90AbsErrorSec)),
        1,
      ),
    ],
  };
}

/** リード時間ごとの ±60 秒以内の割合（%） */
export function withinByLeadOption(
  res: Pick<PredictionsAnalyticsResponse, "byLead">,
): EChartOption {
  const base = baseCartesian({
    categories: res.byLead.map((l) => leadLabel(l.leadBucketMin)),
    legend: false,
  });
  return {
    ...base,
    yAxis: { ...(base.yAxis as object), min: 0, max: 100 },
    series: [
      barSeries(
        "Within ±60 s",
        res.byLead.map((l) => percent(l.within60sRatio)),
        0,
      ),
    ],
  };
}

/** 日別の平均絶対誤差（秒） */
export function errorTrendOption(res: Pick<PredictionsAnalyticsResponse, "daily">): EChartOption {
  return {
    ...baseCartesian({ categories: res.daily.map((d) => d.serviceDate), legend: false }),
    series: [
      lineSeries(
        "Mean absolute error",
        res.daily.map((d) => sec(d.meanAbsErrorSec)),
        0,
      ),
    ],
  };
}
