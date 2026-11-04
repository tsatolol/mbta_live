// アラートの傾向の画面のグラフに渡すデータ（純粋関数。単体テストする）。
// 遅延系とお知らせ系は、いつも別の系列（遅延系 = 1 番の色、お知らせ系 = 2 番の色）
import type { AlertsAnalyticsResponse } from "@/lib/api-schemas/analytics-alerts";
import type { EChartOption } from "@/components/charts/echart";
import { barSeries, baseCartesian, integerYAxis } from "@/components/charts/theme";
import { effectLabel } from "@/components/alerts/format";

export const CATEGORY_LABELS = { disruption: "Disruptions", notice: "Notices" } as const;

/** 分 → 時間（小数 1 桁） */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/** 日別のアラートの時間（遅延系・お知らせ系） */
export function alertHoursByDayOption(res: Pick<AlertsAnalyticsResponse, "daily">): EChartOption {
  return {
    ...baseCartesian({ categories: res.daily.map((d) => d.serviceDate), legend: true }),
    series: [
      barSeries(
        CATEGORY_LABELS.disruption,
        res.daily.map((d) => minutesToHours(d.disruption.activeMinutes)),
        0,
      ),
      barSeries(
        CATEGORY_LABELS.notice,
        res.daily.map((d) => minutesToHours(d.notice.activeMinutes)),
        1,
      ),
    ],
  };
}

/** 日別のアラートの件数（遅延系・お知らせ系） */
export function alertCountByDayOption(res: Pick<AlertsAnalyticsResponse, "daily">): EChartOption {
  return integerYAxis({
    ...baseCartesian({ categories: res.daily.map((d) => d.serviceDate), legend: true }),
    series: [
      barSeries(
        CATEGORY_LABELS.disruption,
        res.daily.map((d) => d.disruption.alertCount),
        0,
      ),
      barSeries(
        CATEGORY_LABELS.notice,
        res.daily.map((d) => d.notice.alertCount),
        1,
      ),
    ],
  });
}

/** effect ごとのアラートの時間。区分の系列に分け、もう一方の区分は空（積み上げて 1 本に見せる） */
export function alertHoursByEffectOption(
  res: Pick<AlertsAnalyticsResponse, "byEffect">,
): EChartOption {
  const hours = (category: "disruption" | "notice") =>
    res.byEffect.map((e) => (e.category === category ? minutesToHours(e.activeMinutes) : null));
  return {
    ...baseCartesian({
      categories: res.byEffect.map((e) => effectLabel(e.effect)),
      legend: true,
      tooltipTrigger: "item",
    }),
    series: [
      { ...barSeries(CATEGORY_LABELS.disruption, hours("disruption"), 0), stack: "effect" },
      { ...barSeries(CATEGORY_LABELS.notice, hours("notice"), 1), stack: "effect" },
    ],
  };
}
