// 005 US6: 文と数値の部分を純粋関数で作る。指標の定義や API の集計は変えない。
import type { HeatmapResponse } from "@/lib/api-schemas/analytics-heatmap";
import { HEATMAP_DAYS_OF_WEEK } from "@/lib/metrics/heatmap";
import { SERVICE_DAY_HOURS } from "@/lib/time";
export interface SummaryPart {
  text: string;
  testId?: string;
}
const text = (value: string): SummaryPart => ({ text: value });
const stat = (id: string, value: string | number): SummaryPart => ({
  text: typeof value === "number" ? value.toLocaleString("en-US") : value,
  testId: `${id}-value`,
});
const plural = (n: number, noun: string) => `${noun}${n === 1 ? "" : "s"}`;
function lineName(route: string | null) {
  return route === null
    ? "All lines"
    : route.startsWith("Green-")
      ? `Green Line ${route.slice(6)}`
      : `${route} Line`;
}
interface HeadwayInput {
  route: string;
  daily: readonly { n: number; p50Sec: number }[];
  totals: { n: number; bunchingCount: number; gapCount: number };
}
/** 日・時間の中央値を件数で重み付けした近似値（既存の画面と同じ）。 */
export function overallMedianMin(res: Pick<HeadwayInput, "daily">): number | null {
  const n = res.daily.reduce((sum, day) => sum + day.n, 0);
  return n === 0
    ? null
    : Math.round((res.daily.reduce((sum, day) => sum + day.p50Sec * day.n, 0) / n / 60) * 10) / 10;
}
export function headwaySummary(res: HeadwayInput): SummaryPart[] {
  const { n, bunchingCount, gapCount } = res.totals;
  if (n === 0)
    return [
      text("No headway data for this selection ("),
      stat("stat-headways", 0),
      text(" headways)."),
    ];
  const median = overallMedianMin(res);
  return [
    text(`${lineName(res.route)} trains had a typical headway of approximately `),
    stat("stat-median", median === null ? "–" : `${median} min`),
    text(" across "),
    stat("stat-headways", n),
    text(` ${plural(n, "measurement")}, with `),
    stat("stat-bunching", bunchingCount),
    text(` ${plural(bunchingCount, "bunching event")} and `),
    stat("stat-gaps", gapCount),
    text(` ${plural(gapCount, "gap")}.`),
  ];
}
interface PredictionInput {
  totals: {
    n: number;
    meanAbsErrorSec: number;
    meanErrorSec: number;
    within60sRatio: number;
  } | null;
}
export function predictionSummary(res: PredictionInput): SummaryPart[] {
  const t = res.totals;
  if (!t || t.n === 0)
    return [
      text("No prediction data for this selection ("),
      stat("stat-predictions", 0),
      text(" predictions)."),
    ];
  const bias = Math.round(t.meanErrorSec);
  const biasLabel = bias === 0 ? "0 s" : bias > 0 ? `+${bias} s (late)` : `${bias} s (early)`;
  return [
    stat("stat-predictions", t.n),
    text(` ${plural(t.n, "prediction")} evaluated: mean absolute error `),
    stat("stat-mae", `${Math.round(t.meanAbsErrorSec)} s`),
    text(", "),
    stat("stat-within", `${Math.round(t.within60sRatio * 1000) / 10}%`),
    text(" within ±60 seconds, and mean bias "),
    stat("stat-bias", biasLabel),
    text("."),
  ];
}
interface AlertInput {
  totals: {
    disruption: { alertCount: number; activeMinutes: number };
    notice: { alertCount: number; activeMinutes: number };
  };
}
export function alertSummary(res: AlertInput): SummaryPart[] {
  const { disruption: d, notice: n } = res.totals;
  const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
  return [
    stat("stat-disruption-alerts", d.alertCount),
    text(` disruption ${plural(d.alertCount, "alert-day")} (`),
    stat("stat-disruption-hours", hours(d.activeMinutes)),
    text(` ${plural(hours(d.activeMinutes), "hour")}) and `),
    stat("stat-notice-alerts", n.alertCount),
    text(` notice ${plural(n.alertCount, "alert-day")} (`),
    stat("stat-notice-hours", hours(n.activeMinutes)),
    text(
      ` ${plural(hours(n.activeMinutes), "hour")}). An alert active on several days is counted once per day.`,
    ),
  ];
}
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function patternSummary(
  res: Pick<HeatmapResponse, "metric" | "route" | "cells">,
): SummaryPart[] {
  const cells = res.cells.filter((c): c is typeof c & { value: number } => c.value !== null);
  const peak = cells.toSorted(
    (a, b) =>
      b.value - a.value ||
      HEATMAP_DAYS_OF_WEEK.findIndex((day) => day === a.dayOfWeek) -
        HEATMAP_DAYS_OF_WEEK.findIndex((day) => day === b.dayOfWeek) ||
      SERVICE_DAY_HOURS.indexOf(a.hour) - SERVICE_DAY_HOURS.indexOf(b.hour),
  )[0];
  if (!peak) return [text("No pattern data for this selection.")];
  const metric =
    res.metric === "headway_p90"
      ? "90th-percentile headway"
      : res.metric === "prediction_abs_error"
        ? "prediction error"
        : "disruption alert time";
  const value =
    res.metric === "headway_p90"
      ? Math.round((peak.value / 60) * 10) / 10
      : res.metric === "prediction_abs_error"
        ? Math.round(peak.value)
        : Math.round(peak.value * 10) / 10;
  const unit =
    res.metric === "headway_p90" ? "min" : res.metric === "prediction_abs_error" ? "s" : "min/day";
  return [
    text(
      `${res.route ? `For ${lineName(res.route)}` : "Across all lines"}, the ${metric} peaked at `,
    ),
    stat("stat-pattern-peak", `${value} ${unit}`),
    text(` on ${DAYS[peak.dayOfWeek]} service days at ${peak.hour}:00 Boston time.`),
  ];
}
