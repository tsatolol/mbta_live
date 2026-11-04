// 003 T035: アラートの傾向の画面のグラフに渡すデータ
import { describe, expect, it } from "vitest";
import {
  alertCountByDayOption,
  alertHoursByDayOption,
  alertHoursByEffectOption,
  minutesToHours,
} from "@/components/analytics/alert-charts";

const amount = (alertCount: number, activeMinutes: number) => ({ alertCount, activeMinutes });
const daily = [
  { serviceDate: "2026-11-09", disruption: amount(2, 300), notice: amount(1, 1440) },
  { serviceDate: "2026-11-10", disruption: amount(0, 0), notice: amount(1, 421) },
];

type Opt = { xAxis: { data: string[] }; series: { name: string; data: (number | null)[] }[] };

describe("アラートの傾向のグラフ", () => {
  it("分 → 時間（小数 1 桁）", () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(421)).toBe(7);
  });

  it("日別の時間: 遅延系とお知らせ系を別の系列に", () => {
    const o = alertHoursByDayOption({ daily }) as Opt;
    expect(o.xAxis.data).toEqual(["2026-11-09", "2026-11-10"]);
    expect(o.series.map((s) => [s.name, s.data])).toEqual([
      ["Disruptions", [5, 0]],
      ["Notices", [24, 7]],
    ]);
  });

  it("日別の件数", () => {
    const o = alertCountByDayOption({ daily }) as Opt;
    expect(o.series.map((s) => s.data)).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });

  it("effect ごと: その区分の系列だけに値を入れる", () => {
    const o = alertHoursByEffectOption({
      byEffect: [
        { effect: "STATION_ISSUE", category: "notice", ...amount(3, 600) },
        { effect: "DELAY", category: "disruption", ...amount(2, 120) },
      ],
    }) as Opt;
    expect(o.xAxis.data).toEqual(["Station Issue", "Delay"]);
    expect(o.series.map((s) => s.data)).toEqual([
      [null, 2],
      [10, null],
    ]);
  });
});

describe("件数のグラフの y 軸", () => {
  it("目盛りは整数だけ", () => {
    const o = alertCountByDayOption({ daily }) as unknown as { yAxis: { minInterval: number } };
    expect(o.yAxis.minInterval).toBe(1);
  });
});
