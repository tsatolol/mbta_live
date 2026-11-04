// 003 T009: 分析 API の期間の解釈
import { describe, expect, it } from "vitest";
import {
  aggregatedPart,
  groupDefinitionVersions,
  includesToday,
  resolveAnalyticsRange,
} from "@/lib/api/analytics-params";

const TODAY = "2026-11-10";

describe("resolveAnalyticsRange", () => {
  it("既定は今日を含む直近 7 日", () => {
    expect(resolveAnalyticsRange({}, TODAY)).toEqual({
      ok: true,
      range: { from: "2026-11-04", to: TODAY },
    });
  });

  it("to だけを指定すると、to を含む 7 日", () => {
    expect(resolveAnalyticsRange({ to: "2026-11-05" }, TODAY)).toEqual({
      ok: true,
      range: { from: "2026-10-30", to: "2026-11-05" },
    });
  });

  it("92 日ちょうどは受け付け、93 日はエラー", () => {
    expect(resolveAnalyticsRange({ from: "2026-08-11", to: TODAY }, TODAY).ok).toBe(true);
    expect(resolveAnalyticsRange({ from: "2026-08-10", to: TODAY }, TODAY).ok).toBe(false);
  });

  it("from > to と、今日より後の to はエラー", () => {
    expect(resolveAnalyticsRange({ from: "2026-11-09", to: "2026-11-08" }, TODAY)).toMatchObject({
      ok: false,
      error: expect.stringContaining("from"),
    });
    expect(resolveAnalyticsRange({ to: "2026-11-11" }, TODAY)).toMatchObject({ ok: false });
  });

  it("1 日だけの期間", () => {
    expect(resolveAnalyticsRange({ from: TODAY, to: TODAY }, TODAY)).toEqual({
      ok: true,
      range: { from: TODAY, to: TODAY },
    });
  });
});

describe("includesToday / aggregatedPart", () => {
  it("今日を含む範囲は、昨日までを集計テーブルから読む", () => {
    const range = { from: "2026-11-04", to: TODAY };
    expect(includesToday(range, TODAY)).toBe(true);
    expect(aggregatedPart(range, TODAY)).toEqual({ from: "2026-11-04", to: "2026-11-09" });
  });

  it("今日だけの範囲は、集計テーブルから読む部分がない", () => {
    const range = { from: TODAY, to: TODAY };
    expect(aggregatedPart(range, TODAY)).toBeNull();
  });

  it("過去だけの範囲は、すべて集計テーブルから読む", () => {
    const range = { from: "2026-11-01", to: "2026-11-03" };
    expect(includesToday(range, TODAY)).toBe(false);
    expect(aggregatedPart(range, TODAY)).toEqual(range);
  });
});

describe("groupDefinitionVersions", () => {
  it("連続する同じ版を 1 つの区間にまとめる。抜けた日や版の変わり目で区切る", () => {
    expect(
      groupDefinitionVersions([
        { serviceDate: "2026-11-01", version: 1 },
        { serviceDate: "2026-11-02", version: 1 },
        { serviceDate: "2026-11-04", version: 1 },
        { serviceDate: "2026-11-05", version: 2 },
        { serviceDate: "2026-11-06", version: 2 },
      ]),
    ).toEqual([
      { version: 1, from: "2026-11-01", to: "2026-11-02" },
      { version: 1, from: "2026-11-04", to: "2026-11-04" },
      { version: 2, from: "2026-11-05", to: "2026-11-06" },
    ]);
    expect(groupDefinitionVersions([])).toEqual([]);
  });
});
