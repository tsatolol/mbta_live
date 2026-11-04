// 003 T037: ヒートマップの集約
import { describe, expect, it } from "vitest";
import {
  HEATMAP_DAYS_OF_WEEK,
  minutesHeatmap,
  startedHours,
  weightedHeatmap,
  type HeatmapCell,
} from "@/lib/metrics/heatmap";
import { SERVICE_DAY_HOURS } from "@/lib/time";

const cell = (cells: HeatmapCell[], dayOfWeek: number, hour: number) =>
  cells.find((c) => c.dayOfWeek === dayOfWeek && c.hour === hour)!;

describe("weightedHeatmap", () => {
  it("月〜日 × 運行日の時間帯（3〜2）の 168 セル。データのないセルは null", () => {
    const cells = weightedHeatmap([]);
    expect(cells).toHaveLength(7 * 24);
    expect(cells[0]).toEqual({ dayOfWeek: 1, hour: 3, value: null, n: 0 });
    expect(cells.at(-1)).toEqual({ dayOfWeek: 0, hour: 2, value: null, n: 0 });
    expect([...new Set(cells.map((c) => c.dayOfWeek))]).toEqual([...HEATMAP_DAYS_OF_WEEK]);
    expect(cells.slice(0, 24).map((c) => c.hour)).toEqual([...SERVICE_DAY_HOURS]);
  });

  it("同じ曜日・時間帯の行を、件数で重み付けして平均する", () => {
    // 11-02 と 11-09 はどちらも月曜
    const cells = weightedHeatmap([
      { serviceDate: "2026-11-02", hour: 8, n: 1, weightedSum: 300 },
      { serviceDate: "2026-11-09", hour: 8, n: 3, weightedSum: 3 * 500 },
      { serviceDate: "2026-11-03", hour: 8, n: 2, weightedSum: 2 * 100 },
    ]);
    expect(cell(cells, 1, 8)).toEqual({ dayOfWeek: 1, hour: 8, value: 450, n: 4 });
    expect(cell(cells, 2, 8)).toEqual({ dayOfWeek: 2, hour: 8, value: 100, n: 2 });
  });

  it("曜日は運行日の曜日（月曜の運行日の 1 時台は、日付は火曜でも月曜）", () => {
    const cells = weightedHeatmap([{ serviceDate: "2026-11-02", hour: 1, n: 1, weightedSum: 60 }]);
    expect(cell(cells, 1, 1).value).toBe(60);
    expect(cell(cells, 2, 1).value).toBeNull();
  });
});

describe("minutesHeatmap", () => {
  const allHours = [...SERVICE_DAY_HOURS];

  it("日あたりの平均。分数の行がない日も 0 分として数える", () => {
    const cells = minutesHeatmap(
      [{ serviceDate: "2026-11-02", hour: 8, minutes: 60 }],
      [
        { serviceDate: "2026-11-02", hours: allHours },
        { serviceDate: "2026-11-09", hours: allHours },
      ],
    );
    expect(cell(cells, 1, 8)).toEqual({ dayOfWeek: 1, hour: 8, value: 30, n: 2 });
    expect(cell(cells, 1, 9)).toEqual({ dayOfWeek: 1, hour: 9, value: 0, n: 2 });
    // 範囲にない曜日は null
    expect(cell(cells, 2, 8).value).toBeNull();
  });

  it("今日のまだ来ていない時間帯は、分母にも分子にも入れない", () => {
    const cells = minutesHeatmap(
      [
        { serviceDate: "2026-11-02", hour: 8, minutes: 60 },
        { serviceDate: "2026-11-09", hour: 8, minutes: 30 },
        { serviceDate: "2026-11-09", hour: 10, minutes: 10 },
      ],
      [
        { serviceDate: "2026-11-02", hours: allHours },
        { serviceDate: "2026-11-09", hours: startedHours(9) },
      ],
    );
    expect(cell(cells, 1, 8)).toMatchObject({ value: 45, n: 2 });
    expect(cell(cells, 1, 10)).toMatchObject({ value: 0, n: 1 });
  });
});

describe("startedHours", () => {
  it("運行日の並びで、今の時間帯まで", () => {
    expect(startedHours(3)).toEqual([3]);
    expect(startedHours(5)).toEqual([3, 4, 5]);
    expect(startedHours(1)).toHaveLength(23);
    expect(startedHours(2)).toEqual([...SERVICE_DAY_HOURS]);
  });
});
