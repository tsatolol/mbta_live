// 003 T019: 運行間隔の画面のグラフに渡すデータ
import { describe, expect, it } from "vitest";
import {
  headwayByHourOption,
  headwayIncidentsOption,
  headwayTrendOption,
  overallMedianMin,
} from "@/components/analytics/headway-charts";

const values = (n: number, p50Sec: number) => ({
  n,
  meanSec: p50Sec,
  p50Sec,
  p90Sec: p50Sec * 2,
  maxSec: p50Sec * 3,
  bunchingCount: 1,
  gapCount: 2,
});

const daily = [
  { serviceDate: "2026-11-09", ...values(30, 360) },
  { serviceDate: "2026-11-10", ...values(10, 400) },
];
const byHour = [
  { hour: 5, ...values(5, 300) },
  { hour: 0, ...values(5, 600) },
];

type Opt = { xAxis: { data: string[] }; series: { name: string; data: number[] }[] };

describe("運行間隔のグラフ", () => {
  it("推移: 日付ごとの p50 と p90（分、小数 1 桁）", () => {
    const o = headwayTrendOption({ daily }) as Opt;
    expect(o.xAxis.data).toEqual(["2026-11-09", "2026-11-10"]);
    expect(o.series.map((s) => [s.name, s.data])).toEqual([
      ["Median (p50)", [6, 6.7]],
      ["90th percentile", [12, 13.3]],
    ]);
  });

  it("時間帯: 受け取った順（運行日の並び）のまま", () => {
    const o = headwayByHourOption({ byHour }) as Opt;
    expect(o.xAxis.data).toEqual(["5:00", "0:00"]);
    expect(o.series[0]!.data).toEqual([5, 10]);
  });

  it("件数: 団子運転と間隔の開き", () => {
    const o = headwayIncidentsOption({ daily }) as Opt;
    expect(o.series.map((s) => s.data)).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("期間全体の中央値（件数で重み付け）。データがなければ null", () => {
    expect(overallMedianMin({ daily })).toBe(6.2);
    expect(overallMedianMin({ daily: [] })).toBeNull();
  });
});
