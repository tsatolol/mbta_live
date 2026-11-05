// パターンの画面のヒートマップに渡すデータ（純粋関数。単体テストする）。
// 色は 1 色の段階（青、明るい = 小さい → 暗い = 大きい）。データのないセルは描かない。
// 色の範囲は、アラートの分数は 0〜最大、運行間隔と予測誤差は最小〜最大
import type { HeatmapResponse } from "@/lib/api-schemas/analytics-heatmap";
import type { HeatmapMetric } from "@/lib/metrics/heatmap";
import { HEATMAP_DAYS_OF_WEEK } from "@/lib/metrics/heatmap";
import { SERVICE_DAY_HOURS } from "@/lib/time";
import type { EChartOption } from "@/components/charts/echart";
import { hourLabel, INK, SEQUENTIAL_BLUE } from "@/components/charts/theme";

const DAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export const METRIC_INFO: Record<
  HeatmapMetric,
  { label: string; unit: string; description: string }
> = {
  headway_p90: {
    label: "Headway (90th percentile)",
    unit: "min",
    description:
      "Long waits: the 90th-percentile headway, averaged over days weighted by the number of headways.",
  },
  prediction_abs_error: {
    label: "Prediction error",
    unit: "s",
    description: "Mean absolute error of arrival predictions, all lead times combined.",
  },
  alert_minutes: {
    label: "Disruption alert minutes",
    unit: "min/day",
    description:
      "Minutes per day with at least one active delay, suspension, shuttle or station closure alert.",
  },
};

/** API の値（秒・分）を表示の単位にする */
export function displayValue(metric: HeatmapMetric, value: number): number {
  if (metric === "headway_p90") return Math.round((value / 60) * 10) / 10;
  if (metric === "prediction_abs_error") return Math.round(value);
  return Math.round(value * 10) / 10;
}

export function dayLabel(dayOfWeek: number): string {
  return DAY_LABELS[dayOfWeek] ?? String(dayOfWeek);
}

/** ヒートマップの設定。x = 運行日の時間帯（3〜2）、y = 月〜日（上から） */
export function heatmapOption(res: Pick<HeatmapResponse, "metric" | "cells">): EChartOption {
  const xIndex = new Map(SERVICE_DAY_HOURS.map((h, i) => [h, i]));
  const yIndex = new Map<number, number>(HEATMAP_DAYS_OF_WEEK.map((d, i) => [d, i]));
  const data = res.cells.flatMap((c) =>
    c.value === null
      ? []
      : [[xIndex.get(c.hour)!, yIndex.get(c.dayOfWeek)!, displayValue(res.metric, c.value)]],
  );
  const values = data.map((d) => d[2]!);
  const info = METRIC_INFO[res.metric];
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontSize: 13 },
    splitArea: { show: false },
  };
  return {
    animation: false,
    textStyle: { color: INK.secondary, fontSize: 13 },
    grid: { left: 40, right: 16, top: 8, bottom: 64 },
    tooltip: { trigger: "item" },
    xAxis: { type: "category", data: SERVICE_DAY_HOURS.map(hourLabel), ...axis },
    yAxis: {
      type: "category",
      data: HEATMAP_DAYS_OF_WEEK.map(dayLabel),
      inverse: true,
      ...axis,
    },
    visualMap: {
      type: "continuous",
      // アラートの分数は 0 分に意味があるので 0 から。運行間隔と予測誤差は、違いが見えるよう最小値から
      min: res.metric === "alert_minutes" || values.length === 0 ? 0 : Math.min(...values),
      max: values.length > 0 ? Math.max(...values) : 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      text: [`${info.unit} (high)`, "low"],
      textStyle: { color: INK.muted, fontSize: 13 },
      inRange: { color: [...SEQUENTIAL_BLUE] },
    },
    series: [
      {
        type: "heatmap",
        name: info.label,
        data,
        itemStyle: { borderColor: INK.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: INK.primary, borderWidth: 1 } },
      },
    ],
  };
}
