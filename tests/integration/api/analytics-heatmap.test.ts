// 003 T038・TR-005: GET /api/analytics/heatmap
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getAnalyticsHeatmap } from "@/lib/api/analytics-heatmap";
import { heatmapResponseSchema, type HeatmapResponse } from "@/lib/api-schemas/analytics-heatmap";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { clearTodayCache } from "@/lib/api/today-cache";
import { runAggregate } from "@/jobs/aggregate";
import { insertAnalyticsAlerts, insertAnalyticsSeed } from "../../helpers/analytics-seed";
import { createTestDb, resetData, testDatabaseUrl } from "../../helpers/db";
import { apiRequest } from "../../helpers/live-seed";
import { seedStaticFromFixtures } from "../../helpers/seed";

const db = createTestDb();
/** 2026-11-10（火）10:00 ET */
const NOW = new Date("2026-11-10T15:00:00Z");
const MON = 1;
const TUE = 2;
const THU = 4;

async function call(query: string) {
  const res = await getAnalyticsHeatmap({ db, clock: fixedClock(NOW) })(
    apiRequest(`/api/analytics/heatmap${query}`),
  );
  return { res, body: (await res.json()) as unknown };
}

async function ok(query: string) {
  const { res, body } = await call(query);
  expect(res.status).toBe(200);
  return heatmapResponseSchema.parse(body);
}

const cell = (res: HeatmapResponse, dayOfWeek: number, hour: number) =>
  res.cells.find((c) => c.dayOfWeek === dayOfWeek && c.hour === hour)!;

beforeAll(async () => {
  // 時計を止めているので、今日の分の使い回しが切れない。ファイルごとに消す
  clearTodayCache();
  await resetData(db);
  await seedStaticFromFixtures(db);
  // 11-03（火）〜11-09（月）を集計。今日（11-10 火）は 10:00 ET まで
  await insertAnalyticsSeed(db, "2026-11-03", "2026-11-10", NOW);
  await insertAnalyticsAlerts(db, "2026-11-03", "2026-11-10", NOW);
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

describe("GET /api/analytics/heatmap", () => {
  it("既定は運行間隔の p90・すべての路線。月〜日 × 運行日の時間帯の 168 セル", async () => {
    const res = await ok("");
    expect(res).toMatchObject({ metric: "headway_p90", route: null, todayIncluded: true });
    expect(res.cells).toHaveLength(168);
    expect(res.cells[0]).toMatchObject({ dayOfWeek: MON, hour: 3, value: null });
    // 14 時台は間隔の開き（Red の 18 分）があるので、10 時台より p90 が大きい
    expect(cell(res, MON, 14).value!).toBeGreaterThan(cell(res, MON, 10).value!);
  });

  it("route=Green（合算）は運行間隔だけ。合算は 3 分ごと", async () => {
    const res = await ok("?route=Green&to=2026-11-09");
    expect(cell(res, MON, 10).value!).toBeLessThan(4 * 60);
    const { res: bad } = await call("?metric=alert_minutes&route=Green");
    expect(bad.status).toBe(400);
  });

  it("予測の平均絶対誤差: 件数で重み付けした平均", async () => {
    const res = await ok("?metric=prediction_abs_error&route=Red&to=2026-11-09");
    // テスト用データの誤差は「リード時間 × 10 秒」で、5 つのリード時間が同じ件数 → 平均 68 秒
    expect(cell(res, MON, 10).value!).toBeCloseTo((10 + 30 + 50 + 100 + 150) / 5, 6);
  });

  it("アラートの分数: 遅延系だけ。日あたりの平均。今日はまだ来ていない時間帯を数えない", async () => {
    const res = await ok("?metric=alert_minutes");
    // Red の遅延は毎日 08:00〜09:00 ET
    expect(cell(res, MON, 8)).toMatchObject({ value: 60, n: 1 });
    // 火曜は 11-10（今日）が範囲に入る。8 時台は始まっているので数え、11 時台はまだ来ていない
    expect(cell(res, TUE, 8)).toMatchObject({ value: 60, n: 1 });
    expect(cell(res, TUE, 11)).toMatchObject({ value: null, n: 0 });
    // Blue のシャトルは 11-05（木）の 12:00〜16:00 ET
    expect(cell(res, THU, 12)).toMatchObject({ value: 60, n: 1 });
    // お知らせ系（Orange）は数えないので、ほかの時間帯は 0
    expect(cell(res, MON, 20)).toMatchObject({ value: 0, n: 1 });
  });

  it("アラートの分数を路線で絞り込む", async () => {
    const res = await ok("?metric=alert_minutes&route=Blue");
    expect(cell(res, MON, 8).value).toBe(0);
    expect(cell(res, THU, 13).value).toBe(60);
  });

  it.each(["?metric=foo", "?route=Foo", "?from=2026-11-11"])(
    "不正な値（%s）で 400",
    async (query) => {
      const { res, body } = await call(query);
      expect(res.status).toBe(400);
      errorResponseSchema.parse(body);
    },
  );
});
