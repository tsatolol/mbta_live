// 003 T033・TR-005: GET /api/analytics/alerts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getAnalyticsAlerts } from "@/lib/api/analytics-alerts";
import { alertsAnalyticsResponseSchema } from "@/lib/api-schemas/analytics-alerts";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { runAggregate } from "@/jobs/aggregate";
import { insertAnalyticsAlerts } from "../../helpers/analytics-seed";
import { createTestDb, resetData, testDatabaseUrl } from "../../helpers/db";
import { apiRequest } from "../../helpers/live-seed";
import { seedStaticFromFixtures } from "../../helpers/seed";

const db = createTestDb();
/** 2026-11-10（火）10:00 ET */
const NOW = new Date("2026-11-10T15:00:00Z");

async function call(query: string, now = NOW) {
  const res = await getAnalyticsAlerts({ db, clock: fixedClock(now) })(
    apiRequest(`/api/analytics/alerts${query}`),
  );
  return { res, body: (await res.json()) as unknown };
}

async function ok(query: string, now = NOW) {
  const { res, body } = await call(query, now);
  expect(res.status).toBe(200);
  return alertsAnalyticsResponseSchema.parse(body);
}

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
  // 11-03 から観測。Blue のシャトルは 11-05 の 12:00〜16:00 ET
  await insertAnalyticsAlerts(db, "2026-11-03", "2026-11-10", NOW);
  // 11-03〜11-07 だけ集計する（11-08・11-09 は集計していない）
  const result = await runAggregate({
    db,
    clock: fixedClock(NOW),
    connectionString: testDatabaseUrl(),
    retentionDays: 28,
    range: { from: "2026-11-03", to: "2026-11-07" },
  });
  expect(result.status).toBe("success");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/analytics/alerts", () => {
  it("すべての路線: 日別に遅延系とお知らせ系を分ける。集計していない日は出さない", async () => {
    const res = await ok("");
    expect(res.route).toBeNull();
    // 期間は 11-04〜11-10。集計済みの 04〜07 と今日（10）
    expect(res.daily.map((d) => d.serviceDate)).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-10",
    ]);
    const day5 = res.daily[1]!;
    // Red の遅延 60 分 + Blue のシャトル 240 分
    expect(day5.disruption).toEqual({ alertCount: 2, activeMinutes: 300 });
    // Orange のお知らせは 1 日中（1,440 分）
    expect(day5.notice).toEqual({ alertCount: 1, activeMinutes: 1440 });
    // 今日は 10:00 ET まで: Red の遅延 60 分、お知らせ 03:00〜10:00（10:00 ちょうどを含む）
    expect(res.daily.at(-1)).toEqual({
      serviceDate: "2026-11-10",
      disruption: { alertCount: 1, activeMinutes: 60 },
      notice: { alertCount: 1, activeMinutes: 7 * 60 + 1 },
    });
  });

  it("予告だけのアラート（Green の運休）は数えない", async () => {
    const res = await ok("");
    expect(res.byEffect.map((e) => e.effect)).not.toContain("SUSPENSION");
    expect((await ok("?route=Green-B")).totals).toEqual({
      disruption: { alertCount: 0, activeMinutes: 0 },
      notice: { alertCount: 0, activeMinutes: 0 },
    });
  });

  it("effect・cause ごとの内訳（分数の多い順）と、区分ごとの合計", async () => {
    const res = await ok("");
    expect(res.byEffect.map((e) => [e.effect, e.category])).toEqual([
      ["STATION_ISSUE", "notice"],
      ["DELAY", "disruption"],
      ["SHUTTLE", "disruption"],
    ]);
    expect(res.byCause[0]!.cause).toBe("CONSTRUCTION");
    expect(res.totals.disruption).toEqual({ alertCount: 6, activeMinutes: 5 * 60 + 240 });
  });

  it("route で絞り込む", async () => {
    const red = await ok("?route=Red");
    expect(red.route).toBe("Red");
    expect(red.byEffect.map((e) => e.effect)).toEqual(["DELAY"]);
    expect(red.totals.notice.alertCount).toBe(0);
  });

  it.each(["?route=Green", "?route=All", "?to=2026-11-11"])(
    "不正な値（%s）で 400",
    async (query) => {
      const { res, body } = await call(query);
      expect(res.status).toBe(400);
      errorResponseSchema.parse(body);
    },
  );
});
