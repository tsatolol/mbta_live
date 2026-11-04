// 運行間隔の画面のグラフに渡すデータ（純粋関数。単体テストする）
import type { HeadwaysResponse } from "@/lib/api-schemas/analytics-headways";
import type { EChartOption } from "@/components/charts/echart";
import {
  barSeries,
  baseCartesian,
  integerYAxis,
  hourLabel,
  lineSeries,
  secToMin,
} from "@/components/charts/theme";

/** 日別の運行間隔の推移（p50 と p90、分） */
export function headwayTrendOption(res: Pick<HeadwaysResponse, "daily">): EChartOption {
  return {
    ...baseCartesian({
      categories: res.daily.map((d) => d.serviceDate),
      legend: true,
    }),
    series: [
      lineSeries(
        "Median (p50)",
        res.daily.map((d) => secToMin(d.p50Sec)),
        0,
      ),
      lineSeries(
        "90th percentile",
        res.daily.map((d) => secToMin(d.p90Sec)),
        1,
      ),
    ],
  };
}

/** 時間帯ごとの運行間隔の分布（p50 と p90、分）。運行日の時間帯の並び */
export function headwayByHourOption(res: Pick<HeadwaysResponse, "byHour">): EChartOption {
  return {
    ...baseCartesian({
      categories: res.byHour.map((h) => hourLabel(h.hour)),
      legend: true,
    }),
    series: [
      barSeries(
        "Median (p50)",
        res.byHour.map((h) => secToMin(h.p50Sec)),
        0,
      ),
      barSeries(
        "90th percentile",
        res.byHour.map((h) => secToMin(h.p90Sec)),
        1,
      ),
    ],
  };
}

/** 日別の団子運転と間隔の開きの件数 */
export function headwayIncidentsOption(res: Pick<HeadwaysResponse, "daily">): EChartOption {
  return integerYAxis({
    ...baseCartesian({
      categories: res.daily.map((d) => d.serviceDate),
      legend: true,
    }),
    series: [
      barSeries(
        "Bunching (< 2 min)",
        res.daily.map((d) => d.bunchingCount),
        0,
      ),
      barSeries(
        "Gaps (> 2× usual)",
        res.daily.map((d) => d.gapCount),
        1,
      ),
    ],
  });
}

/** 期間全体の運行間隔の中央値（件数で重み付けした近似、分）。データがなければ null */
export function overallMedianMin(res: Pick<HeadwaysResponse, "daily">): number | null {
  const n = res.daily.reduce((s, d) => s + d.n, 0);
  if (n === 0) return null;
  return secToMin(res.daily.reduce((s, d) => s + d.p50Sec * d.n, 0) / n);
}
