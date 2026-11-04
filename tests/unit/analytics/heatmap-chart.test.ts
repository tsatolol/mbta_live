// 003 T041: パターンの画面のヒートマップに渡すデータ
import { describe, expect, it } from "vitest";
import { dayLabel, displayValue, heatmapOption } from "@/components/analytics/heatmap-chart";

type Opt = {
  xAxis: { data: string[] };
  yAxis: { data: string[]; inverse: boolean };
  visualMap: { min: number; max: number };
  series: { data: number[][] }[];
};

describe("ヒートマップ", () => {
  it("x は運行日の時間帯（3:00 から）、y は月〜日（上から）", () => {
    const o = heatmapOption({ metric: "headway_p90", cells: [] }) as Opt;
    expect(o.xAxis.data.slice(0, 2)).toEqual(["3:00", "4:00"]);
    expect(o.xAxis.data.at(-1)).toBe("2:00");
    expect(o.yAxis.data).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(o.yAxis.inverse).toBe(true);
    expect(o.series[0]!.data).toEqual([]);
  });

  it("データのあるセルだけを [x, y, 表示の値] にする。運行間隔の色の範囲は最小〜最大", () => {
    const o = heatmapOption({
      metric: "headway_p90",
      cells: [
        { dayOfWeek: 1, hour: 3, value: 360, n: 5 },
        { dayOfWeek: 0, hour: 2, value: 900, n: 1 },
        { dayOfWeek: 2, hour: 10, value: null, n: 0 },
      ],
    }) as Opt;
    expect(o.series[0]!.data).toEqual([
      [0, 0, 6],
      [23, 6, 15],
    ]);
    expect(o.visualMap).toMatchObject({ min: 6, max: 15 });
  });

  it("アラートの分数の色の範囲は 0 から", () => {
    const o = heatmapOption({
      metric: "alert_minutes",
      cells: [{ dayOfWeek: 1, hour: 8, value: 30, n: 2 }],
    }) as Opt;
    expect(o.visualMap).toMatchObject({ min: 0, max: 30 });
  });

  it("表示の単位: 運行間隔は分、予測誤差は秒、アラートは分", () => {
    expect(displayValue("headway_p90", 390)).toBe(6.5);
    expect(displayValue("prediction_abs_error", 67.6)).toBe(68);
    expect(displayValue("alert_minutes", 12.34)).toBe(12.3);
    expect(dayLabel(0)).toBe("Sun");
  });
});
