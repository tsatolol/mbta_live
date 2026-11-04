// 003 T017・TR-004・TR-005: GET /api/analytics/headways
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getAnalyticsHeadways } from "@/lib/api/analytics-headways";
import { headwaysResponseSchema } from "@/lib/api-schemas/analytics-headways";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { AGGREGATE_DEFINITION_VERSION } from "@/lib/metrics/constants";
import { clearTodayCache } from "@/lib/api/today-cache";
import { runAggregate } from "@/jobs/aggregate";
import { insertAnalyticsSeed } from "../../helpers/analytics-seed";
import { createTestDb, resetData, testDatabaseUrl } from "../../helpers/db";
import { apiRequest } from "../../helpers/live-seed";
import { seedStaticFromFixtures } from "../../helpers/seed";

const db = createTestDb();
/** 2026-11-10（火）10:00 ET */
const NOW = new Date("2026-11-10T15:00:00Z");

async function call(query: string, now = NOW) {
  const res = await getAnalyticsHeadways({ db, clock: fixedClock(now) })(
    apiRequest(`/api/analytics/headways${query}`),
  );
  return { res, body: (await res.json()) as unknown };
}

async function ok(query: string, now = NOW) {
  const { res, body } = await call(query, now);
  expect(res.status).toBe(200);
  return headwaysResponseSchema.parse(body);
}

function aggregate(now: Date, range?: { from: string; to: string }) {
  return runAggregate({
    db,
    clock: fixedClock(now),
    connectionString: testDatabaseUrl(),
    retentionDays: 28,
    range,
  });
}

beforeAll(async () => {
  // 時計を止めているので、今日の分の使い回しが切れない。ファイルごとに消す
  clearTodayCache();
  await resetData(db);
  await seedStaticFromFixtures(db);
  // 11-03〜11-09 は 1 日分、今日（11-10）は 10:00 ET まで
  await insertAnalyticsSeed(db, "2026-11-03", "2026-11-10", NOW);
  const result = await aggregate(NOW, { from: "2026-11-03", to: "2026-11-09" });
  expect(result.status).toBe("success");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/analytics/headways", () => {
  it("既定は Red・両方向・全駅・今日を含む直近 7 日。今日の分は生データから計算する", async () => {
    const res = await ok("");
    expect(res).toMatchObject({
      route: "Red",
      direction: null,
      stop: null,
      from: "2026-11-04",
      to: "2026-11-10",
      todayIncluded: true,
      lastAggregatedServiceDate: "2026-11-09",
      definitionVersions: [
        { version: AGGREGATE_DEFINITION_VERSION, from: "2026-11-04", to: "2026-11-10" },
      ],
    });
    expect(res.daily.map((d) => d.serviceDate)).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
    ]);
    // 今日は 10:00 ET までなので少ない
    expect(res.daily.at(-1)!.n).toBeLessThan(res.daily[0]!.n);
    // 時間帯は運行日の並び（5 時台から）
    expect(res.byHour[0]!.hour).toBe(5);
    expect(res.byHour.at(-1)!.hour).toBe(0);
    expect(res.stops.map((s) => s.name)).toEqual(["Alewife", "Davis", "Harvard", "Porter"]);
    // 団子運転は毎日 08:00 台に各駅 1 回、間隔の開きは基準のある日の 14:00 台
    expect(res.totals.bunchingCount).toBe(7 * 4);
    expect(res.totals.gapCount).toBeGreaterThan(0);
    expect(res.byHour.find((h) => h.hour === 14)!.gapCount).toBe(res.totals.gapCount);
  });

  it("route=Green は、支線を合算した幹線の駅だけ", async () => {
    const res = await ok("?route=Green");
    expect(res.stops.map((s) => s.id).sort()).toEqual(["place-boyls", "place-pktrm"]);
    // 合算すると 3 分ごと
    for (const d of res.daily.slice(0, -1)) expect(d.meanSec).toBeLessThan(4 * 60);
  });

  it("stop で絞り込む。駅の選択肢は絞り込む前のまま", async () => {
    // 今日は 10:00 ET で途切れ、駅ごとに到着の数が違うので、過去の日だけで比べる
    const all = await ok("?route=Red&direction=0&to=2026-11-09");
    const harvard = await ok("?route=Red&direction=0&stop=place-harsq&to=2026-11-09");
    expect(harvard.stop).toEqual({ id: "place-harsq", name: "Harvard" });
    expect(harvard.stops).toEqual(all.stops);
    expect(harvard.totals.n * 4).toBe(all.totals.n);
  });

  it("データのない方向は空", async () => {
    const res = await ok("?route=Red&direction=1");
    expect(res.daily).toEqual([]);
    expect(res.totals).toEqual({ n: 0, bunchingCount: 0, gapCount: 0 });
  });

  it("今日だけの期間は、集計テーブルを読まない", async () => {
    const res = await ok("?from=2026-11-10&to=2026-11-10");
    expect(res.daily.map((d) => d.serviceDate)).toEqual(["2026-11-10"]);
    expect(res.definitionVersions).toEqual([
      { version: AGGREGATE_DEFINITION_VERSION, from: "2026-11-10", to: "2026-11-10" },
    ]);
  });

  it.each([
    "?route=Foo",
    "?direction=2",
    "?from=2026-11-09&to=2026-11-08",
    "?from=2026-13-01",
    "?to=2026-11-11",
    "?stop=bad%20id",
  ])("不正な値（%s）で 400", async (query) => {
    const { res, body } = await call(query);
    expect(res.status).toBe(400);
    errorResponseSchema.parse(body);
  });
});

describe("当日分と翌日の集計の一致（TR-004）", () => {
  it("11-11 の終わりに生データから計算した値と、翌日に集計した値が同じ", async () => {
    await insertAnalyticsSeed(db, "2026-11-11", "2026-11-11");
    // 11-11 の運行日の終わり（翌 02:59 ET）
    const endOfDay = new Date("2026-11-12T07:59:00Z");
    const live = await ok("?route=Red&from=2026-11-11&to=2026-11-11", endOfDay);
    expect(live.todayIncluded).toBe(true);

    const nextMorning = new Date("2026-11-12T09:30:00Z");
    expect((await aggregate(nextMorning)).status).toBe("success");
    const aggregated = await ok("?route=Red&from=2026-11-11&to=2026-11-11", nextMorning);
    expect(aggregated.todayIncluded).toBe(false);
    expect(aggregated.lastAggregatedServiceDate).toBe("2026-11-11");
    expect(aggregated.daily).toEqual(live.daily);
    expect(aggregated.byHour).toEqual(live.byHour);
    expect(aggregated.totals).toEqual(live.totals);
  });
});
