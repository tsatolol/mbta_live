// 003 T025・TR-005: GET /api/analytics/predictions
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getAnalyticsPredictions } from "@/lib/api/analytics-predictions";
import { predictionsResponseSchema } from "@/lib/api-schemas/analytics-predictions";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { runAggregate } from "@/jobs/aggregate";
import { insertAnalyticsSeed } from "../../helpers/analytics-seed";
import { createTestDb, resetData, testDatabaseUrl } from "../../helpers/db";
import { apiRequest } from "../../helpers/live-seed";
import { seedStaticFromFixtures } from "../../helpers/seed";

const db = createTestDb();
/** 2026-11-10（火）10:00 ET */
const NOW = new Date("2026-11-10T15:00:00Z");

async function call(query: string, now = NOW) {
  const res = await getAnalyticsPredictions({ db, clock: fixedClock(now) })(
    apiRequest(`/api/analytics/predictions${query}`),
  );
  return { res, body: (await res.json()) as unknown };
}

async function ok(query: string, now = NOW) {
  const { res, body } = await call(query, now);
  expect(res.status).toBe(200);
  return predictionsResponseSchema.parse(body);
}

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
  await insertAnalyticsSeed(db, "2026-11-03", "2026-11-10", NOW);
  const result = await runAggregate({
    db,
    clock: fixedClock(NOW),
    connectionString: testDatabaseUrl(),
    retentionDays: 28,
    range: { from: "2026-11-03", to: "2026-11-09" },
  });
  expect(result.status).toBe("success");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/analytics/predictions", () => {
  it("既定はすべての路線。リード時間ごとの統計（短い順）、種類ごと、日別、合計", async () => {
    const res = await ok("");
    expect(res).toMatchObject({
      route: null,
      direction: null,
      updateType: null,
      todayIncluded: true,
    });
    expect(res.byLead.map((l) => l.leadBucketMin)).toEqual([1, 3, 5, 10, 15]);
    // テスト用データの誤差は「リード時間 × 10 秒」（符号は便ごとに変わる）
    for (const l of res.byLead) expect(l.meanAbsErrorSec).toBeCloseTo(l.leadBucketMin * 10, 6);
    expect(res.byLead.map((l) => l.within60sRatio)).toEqual([1, 1, 1, 0, 0]);
    expect(res.byUpdateType.map((t) => t.updateType)).toEqual(["MID_TRIP", "AT_TERMINAL"]);
    expect(res.daily).toHaveLength(7);
    expect(res.totals!.n).toBe(res.byLead.reduce((s, l) => s + l.n, 0));
  });

  it("updateType で絞り込む。AT_TERMINAL は偶数の便だけなので誤差はすべて正（予測より遅く到着）", async () => {
    const res = await ok("?updateType=AT_TERMINAL");
    expect(res.updateType).toBe("AT_TERMINAL");
    expect(res.byUpdateType.map((t) => t.updateType)).toEqual(["AT_TERMINAL"]);
    for (const l of res.byLead) expect(l.meanErrorSec).toBeCloseTo(l.leadBucketMin * 10, 6);
  });

  it("route と direction で絞り込む", async () => {
    const red = await ok("?route=Red&to=2026-11-09");
    const all = await ok("?to=2026-11-09");
    expect(red.totals!.n).toBeLessThan(all.totals!.n);
    expect((await ok("?route=Red&direction=1")).totals).toBeNull();
  });

  it("補間の到着（10 本に 1 本）の予測は数えない", async () => {
    const res = await ok("?route=Red&from=2026-11-09&to=2026-11-09");
    const arrivals = await db.arrivalEvent.count({
      where: { routeId: "Red", serviceDate: new Date("2026-11-09T00:00:00Z") },
    });
    const interpolated = await db.arrivalEvent.count({
      where: {
        routeId: "Red",
        serviceDate: new Date("2026-11-09T00:00:00Z"),
        source: "interpolated",
      },
    });
    expect(interpolated).toBeGreaterThan(0);
    // 到着 1 件につき 5 つのリード時間
    expect(res.totals!.n).toBe((arrivals - interpolated) * 5);
  });

  it.each(["?route=Green", "?updateType=FOO", "?direction=x", "?from=2026-11-11"])(
    "不正な値（%s）で 400",
    async (query) => {
      const { res, body } = await call(query);
      expect(res.status).toBe(400);
      errorResponseSchema.parse(body);
    },
  );
});
