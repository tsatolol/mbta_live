// 003 TR-001: 運行間隔の指標（TypeScript 版）
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  combineHeadwayStats,
  gapBaselines,
  headwayStats,
  percentileCont,
  summarizeHeadways,
  type HeadwayArrival,
  type HeadwayStatValues,
} from "@/lib/metrics/headways";
import { SERVICE_DAY_HOURS } from "@/lib/time";

/** 2026-11-02（月）の ET 10:00 からの分 */
const at = (min: number, sec = 0) => new Date(Date.UTC(2026, 10, 2, 15, min, sec));

function arrivals(
  minutes: readonly number[],
  over: Partial<HeadwayArrival> = {},
): HeadwayArrival[] {
  return minutes.map((m) => ({
    routeId: "Red",
    directionId: 0,
    stopId: "place-pktrm",
    arrivedAt: at(m),
    ...over,
  }));
}

const noTrunk = { greenTrunkStops: new Set<string>() };

describe("percentileCont（PostgreSQL と同じ線形補間）", () => {
  it.each([
    [[1], 0.5, 1],
    [[1, 2], 0.5, 1.5],
    [[1, 2, 3, 4], 0.9, 3.7],
    [[10, 20, 30, 40, 50], 0.5, 30],
  ])("%j の %d は %d", (values, p, expected) => {
    expect(percentileCont(values, p)).toBeCloseTo(expected, 10);
  });

  it("空なら NaN", () => {
    expect(percentileCont([], 0.5)).toBeNaN();
  });
});

describe("headwayStats", () => {
  it("連続する到着の差を、時間帯（後の到着の ET の時）ごとにまとめる", () => {
    // 10:00, 10:06, 10:12, 10:20 → 間隔 6, 6, 8 分（すべて 10 時台）
    const rows = headwayStats(arrivals([0, 6, 12, 20]), noTrunk);
    expect(rows).toEqual([
      {
        routeId: "Red",
        directionId: 0,
        stopId: "place-pktrm",
        hour: 10,
        n: 3,
        meanSec: (360 + 360 + 480) / 3,
        p50Sec: 360,
        p90Sec: 360 + (480 - 360) * 0.8,
        maxSec: 480,
        bunchingCount: 0,
        gapCount: 0,
      },
    ]);
  });

  it("時刻の順に並べてから差をとる。時間帯は後の到着で決まる", () => {
    // 10:55, 11:01 → 6 分の間隔は 11 時台
    const rows = headwayStats(arrivals([61, 55]), noTrunk);
    expect(rows.map((r) => [r.hour, r.n, r.meanSec])).toEqual([[11, 1, 360]]);
  });

  it("60 分を超える間隔は除く（ちょうど 60 分は含む）", () => {
    const rows = headwayStats(arrivals([0, 60, 121]), noTrunk);
    // 10:00 → 11:00 は 60 分ちょうど（含む）、11:00 → 12:01 は 61 分（除く）
    expect(rows.map((r) => [r.hour, r.n, r.maxSec])).toEqual([[11, 1, 3600]]);
  });

  it("団子運転は 2 分未満（ちょうど 2 分は含まない）", () => {
    const rows = headwayStats(
      [...arrivals([0]), ...arrivals([1, 3], {}), { ...arrivals([4])[0]!, arrivedAt: at(4, 59) }],
      noTrunk,
    );
    // 間隔: 1 分（団子）、2 分（団子でない）、1 分 59 秒（団子）
    expect(rows[0]).toMatchObject({ n: 3, bunchingCount: 2 });
  });

  it("間隔の開きは、基準の中央値 × 2 より大きい間隔。基準がなければ数えない", () => {
    const list = arrivals([0, 6, 18, 31]); // 6, 12, 13 分
    const withBaseline = headwayStats(list, { ...noTrunk, baseline: () => 360 });
    expect(withBaseline[0]).toMatchObject({ gapCount: 1 }); // 13 分 > 12 分。12 分ちょうどは数えない
    const without = headwayStats(list, { ...noTrunk, baseline: () => undefined });
    expect(without[0]).toMatchObject({ gapCount: 0 });
  });

  it("路線・方向・駅ごとに別々に計算する", () => {
    const rows = headwayStats(
      [
        ...arrivals([0, 6]),
        ...arrivals([1, 9], { directionId: 1 }),
        ...arrivals([2, 5], { stopId: "place-dwnxg" }),
      ],
      noTrunk,
    );
    expect(rows.map((r) => [r.directionId, r.stopId, r.meanSec])).toEqual([
      [0, "place-dwnxg", 180],
      [0, "place-pktrm", 360],
      [1, "place-pktrm", 480],
    ]);
  });

  it("Green の幹線の駅では、支線をまとめた Green も作る。幹線でない駅では作らない", () => {
    const green = [
      ...arrivals([0, 12], { routeId: "Green-B" }),
      ...arrivals([3, 15], { routeId: "Green-C" }),
      ...arrivals([0, 12], { routeId: "Green-B", stopId: "place-bland" }),
      ...arrivals([5, 17], { routeId: "Green-E", stopId: "place-bland" }),
    ];
    const rows = headwayStats(green, { greenTrunkStops: new Set(["place-pktrm"]) });
    const combined = rows.filter((r) => r.routeId === "Green");
    // Park Street: 0, 3, 12, 15 → 3, 9, 3 分
    expect(combined).toEqual([
      expect.objectContaining({ stopId: "place-pktrm", n: 3, meanSec: (180 + 540 + 180) / 3 }),
    ]);
    expect(rows.filter((r) => r.routeId === "Green-B")).toHaveLength(2);
  });

  it("夏時間が終わる日の 1 時台（2 回ある）は 1 つの時間帯にまとめる", () => {
    // 2026-11-01: EDT 01:50（05:50Z）, EST 01:10（06:10Z）, EST 01:20（06:20Z）
    const list = ["2026-11-01T05:50:00Z", "2026-11-01T06:10:00Z", "2026-11-01T06:20:00Z"].map(
      (iso) => ({
        routeId: "Red",
        directionId: 0,
        stopId: "place-pktrm",
        arrivedAt: new Date(iso),
      }),
    );
    const rows = headwayStats(list, noTrunk);
    expect(rows.map((r) => [r.hour, r.n])).toEqual([[1, 2]]);
  });

  it("到着が 0 件・1 件なら行はない", () => {
    expect(headwayStats([], noTrunk)).toEqual([]);
    expect(headwayStats(arrivals([0]), noTrunk)).toEqual([]);
  });

  it("不変条件: 運行間隔は負にならず、件数は到着の数 − 1 以下", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 600 }), { maxLength: 40 }), (mins) => {
        const rows = headwayStats(arrivals(mins), noTrunk);
        const n = rows.reduce((s, r) => s + r.n, 0);
        expect(n).toBeLessThanOrEqual(Math.max(0, mins.length - 1));
        for (const r of rows) {
          expect(r.p50Sec).toBeGreaterThanOrEqual(0);
          expect(r.meanSec).toBeGreaterThanOrEqual(0);
          expect(r.p90Sec).toBeLessThanOrEqual(r.maxSec + 0.5);
          expect(r.bunchingCount).toBeLessThanOrEqual(r.n);
        }
      }),
    );
  });
});

describe("gapBaselines", () => {
  const key = { routeId: "Red", directionId: 0, stopId: "place-pktrm", hour: 10 };
  const row = (serviceDate: string, p50Sec: number) => ({ ...key, serviceDate, p50Sec });

  it("前の 28 日の、同じ曜日種別の日の p50 の中央値", () => {
    // 対象 2026-11-10（火）。平日: 11-09, 11-06, 11-05 / 土曜 11-07 / 当日 11-10 / 29 日前 10-12
    const lookup = gapBaselines(
      [
        row("2026-11-09", 300),
        row("2026-11-06", 360),
        row("2026-11-05", 420),
        row("2026-11-07", 900),
        row("2026-11-10", 1000),
        row("2026-10-12", 1000),
      ],
      "2026-11-10",
    );
    expect(lookup(key)).toBe(360);
    expect(lookup({ ...key, hour: 11 })).toBeUndefined();
  });

  it("28 日前ちょうどは含む", () => {
    const lookup = gapBaselines([row("2026-10-13", 500)], "2026-11-10");
    expect(lookup(key)).toBe(500);
  });
});

describe("combineHeadwayStats / summarizeHeadways", () => {
  const v = (
    n: number,
    meanSec: number,
    p50Sec: number,
    extra: Partial<HeadwayStatValues> = {},
  ) => ({
    n,
    meanSec,
    p50Sec,
    p90Sec: p50Sec * 2,
    maxSec: p50Sec * 3,
    bunchingCount: 0,
    gapCount: 0,
    ...extra,
  });

  it("平均は正確、p50 / p90 は件数で重み付けした平均、最大は最大、件数は合計", () => {
    expect(
      combineHeadwayStats([v(1, 100, 100, { bunchingCount: 1 }), v(3, 200, 300, { gapCount: 2 })]),
    ).toEqual({
      n: 4,
      meanSec: 175,
      p50Sec: 250,
      p90Sec: 500,
      maxSec: 900,
      bunchingCount: 1,
      gapCount: 2,
    });
    expect(combineHeadwayStats([])).toBeNull();
  });

  it("運行日ごと（古い順）と、時間帯ごと（運行日の時間帯の並び）にまとめる", () => {
    const rows = [
      { serviceDate: "2026-11-03", hour: 0, ...v(2, 300, 300) },
      { serviceDate: "2026-11-02", hour: 10, ...v(2, 360, 360) },
      { serviceDate: "2026-11-02", hour: 0, ...v(2, 600, 600, { gapCount: 1 }) },
    ];
    const s = summarizeHeadways(rows, SERVICE_DAY_HOURS);
    expect(s.daily.map((d) => [d.serviceDate, d.n, d.meanSec])).toEqual([
      ["2026-11-02", 4, 480],
      ["2026-11-03", 2, 300],
    ]);
    // 10 時は 0 時より前（運行日は 3 時に始まる）
    expect(s.byHour.map((h) => [h.hour, h.n])).toEqual([
      [10, 2],
      [0, 4],
    ]);
    expect(s.totals).toEqual({ n: 6, bunchingCount: 0, gapCount: 1 });
  });
});
