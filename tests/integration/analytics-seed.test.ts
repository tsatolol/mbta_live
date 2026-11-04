// 003 T011: 分析のテスト用データが、決まった規則どおりに入ること
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceDateToDbDate } from "@/lib/time";
import {
  ANALYTICS_SEED,
  analyticsSeedForDay,
  insertAnalyticsSeed,
} from "../helpers/analytics-seed";
import { createTestDb, resetData } from "../helpers/db";

const db = createTestDb();

beforeAll(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("分析のテスト用データ", () => {
  it("何度作っても同じ", () => {
    expect(analyticsSeedForDay("2026-11-02")).toEqual(analyticsSeedForDay("2026-11-02"));
  });

  it("団子運転（90 秒）と間隔の開き（18 分）が Red に 1 回ずつある", () => {
    const red = analyticsSeedForDay("2026-11-02")
      .arrivals.filter((a) => a.routeId === "Red" && a.stopId === ANALYTICS_SEED.redStations[0])
      .map((a) => a.arrivedAt.getTime())
      .sort((a, b) => a - b);
    const gaps = red.slice(1).map((t, i) => (t - red[i]!) / 1000);
    expect(gaps.filter((g) => g < 120)).toHaveLength(1);
    expect(gaps.filter((g) => g > 15 * 60)).toHaveLength(1);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
  });

  it("until より後の到着と予測は作らない", () => {
    const until = new Date("2026-11-02T15:00:00Z"); // 10:00 ET
    const seed = analyticsSeedForDay("2026-11-02", until);
    expect(seed.arrivals.every((a) => a.arrivedAt <= until)).toBe(true);
    expect(seed.samples.every((s) => s.observedAt <= until)).toBe(true);
    expect(seed.arrivals.length).toBeLessThan(analyticsSeedForDay("2026-11-02").arrivals.length);
  });

  it("DB に入る（パーティションも作る）", async () => {
    const result = await insertAnalyticsSeed(db, "2026-11-01", "2026-11-02");
    const day = analyticsSeedForDay("2026-11-02");
    expect(result.arrivals).toBe(
      analyticsSeedForDay("2026-11-01").arrivals.length + day.arrivals.length,
    );
    expect(
      await db.arrivalEvent.count({ where: { serviceDate: serviceDateToDbDate("2026-11-02") } }),
    ).toBe(day.arrivals.length);
    expect(
      await db.predictionSample.count({
        where: { serviceDate: serviceDateToDbDate("2026-11-02") },
      }),
    ).toBe(day.samples.length);
  });
});
