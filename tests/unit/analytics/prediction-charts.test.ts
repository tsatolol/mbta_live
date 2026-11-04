// 003 T027: 予測精度の画面のグラフに渡すデータ
import { describe, expect, it } from "vitest";
import {
  biasLabel,
  errorByLeadOption,
  errorTrendOption,
  percent,
  updateTypeLabel,
  withinByLeadOption,
} from "@/components/analytics/prediction-charts";

const v = (meanAbsErrorSec: number, within60sRatio: number) => ({
  n: 10,
  meanErrorSec: 0,
  meanAbsErrorSec,
  p90AbsErrorSec: meanAbsErrorSec * 1.5,
  within60sRatio,
});
const byLead = [
  { leadBucketMin: 1, ...v(10.4, 1) },
  { leadBucketMin: 10, ...v(100, 0.123) },
];

type Opt = {
  xAxis: { data: string[] };
  yAxis: { min?: number; max?: number };
  series: { name: string; data: number[] }[];
};

describe("予測精度のグラフ", () => {
  it("リード時間ごとの誤差（秒、整数）", () => {
    const o = errorByLeadOption({ byLead }) as Opt;
    expect(o.xAxis.data).toEqual(["1 min", "10 min"]);
    expect(o.series.map((s) => [s.name, s.data])).toEqual([
      ["Mean absolute error", [10, 100]],
      ["90th percentile", [16, 150]],
    ]);
  });

  it("±60 秒以内の割合（%、0〜100）", () => {
    const o = withinByLeadOption({ byLead }) as Opt;
    expect(o.series[0]!.data).toEqual([100, 12.3]);
    expect(o.yAxis).toMatchObject({ min: 0, max: 100 });
  });

  it("日別の平均絶対誤差", () => {
    const o = errorTrendOption({ daily: [{ serviceDate: "2026-11-09", ...v(42.6, 0.5) }] }) as Opt;
    expect(o.xAxis.data).toEqual(["2026-11-09"]);
    expect(o.series[0]!.data).toEqual([43]);
  });

  it("表示用の文字列", () => {
    expect(percent(0.9876)).toBe(98.8);
    expect(biasLabel(12.4)).toBe("+12 s (late)");
    expect(biasLabel(-3.6)).toBe("-4 s (early)");
    expect(biasLabel(0.2)).toBe("0 s");
    expect(updateTypeLabel("AT_TERMINAL")).toBe("At terminal");
    expect(updateTypeLabel("NEW_KIND")).toBe("NEW_KIND");
  });
});
