// 003 TR-002: アラートの集計 SQL と TypeScript 版が、同じデータで同じ結果になる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeAlertStats } from "@/lib/db/analytics-sql";
import { parseActivePeriod } from "@/lib/api/alert-item";
import { alertDayStats, type AlertForStats } from "@/lib/metrics/alert-stats";
import type { ServiceDate } from "@/lib/time";
import { createTestDb, resetData } from "../../helpers/db";
import { seedLive } from "../../helpers/live-seed";

const db = createTestDb();

async function alertsForStats(): Promise<AlertForStats[]> {
  const [alerts, links] = await Promise.all([db.alert.findMany(), db.alertRoute.findMany()]);
  return alerts.map((a) => ({
    id: a.id,
    effect: a.effect,
    cause: a.cause,
    firstSeenAt: a.firstSeenAt,
    lastSeenAt: a.lastSeenAt,
    activePeriod: parseActivePeriod(a.activePeriod),
    routeIds: links.filter((l) => l.alertId === a.id).map((l) => l.routeId),
  }));
}

async function expectSameAsTypeScript(serviceDate: ServiceDate) {
  const sql = await computeAlertStats(db, serviceDate);
  const ts = alertDayStats(await alertsForStats(), serviceDate);
  expect(
    sql.daily.map((r) => ({
      routeId: r.route_id,
      effect: r.effect,
      cause: r.cause,
      alertCount: r.alert_count,
      activeMinutes: r.active_minutes,
    })),
  ).toEqual(ts.daily);
  expect(
    sql.hourly.map((r) => ({
      routeId: r.route_id,
      hour: r.hour,
      category: r.category,
      activeMinutes: r.active_minutes,
    })),
  ).toEqual(ts.hourly);
  return ts;
}

async function insertAlert(
  id: string,
  over: {
    effect?: string;
    routes: string[];
    periods: { start: string; end: string | null }[];
    firstSeenAt: string;
    lastSeenAt: string;
    inFeed?: boolean;
  },
) {
  await db.alert.create({
    data: {
      id,
      effect: over.effect ?? "DELAY",
      cause: "UNKNOWN_CAUSE",
      severity: 5,
      header: id,
      lifecycle: "NEW",
      activePeriod: over.periods,
      informedEntity: over.routes.map((route) => ({ route })),
      firstSeenAt: new Date(over.firstSeenAt),
      lastSeenAt: new Date(over.lastSeenAt),
      inFeed: over.inFeed ?? false,
    },
  });
  await db.alertRoute.createMany({
    data: over.routes.map((routeId) => ({ alertId: id, routeId })),
  });
}

beforeAll(async () => {
  await resetData(db);
  // フィクスチャのアラート（2026-11-02 10:20 ET に 1 回だけ観測）
  await seedLive(db);
  await insertAlert("multi-route", {
    routes: ["Green-B", "Green-C", "Green-D"],
    periods: [
      { start: "2026-11-09T13:00:00Z", end: "2026-11-09T14:00:00Z" },
      { start: "2026-11-09T13:30:00Z", end: "2026-11-09T15:15:00Z" },
    ],
    firstSeenAt: "2026-11-09T12:00:00Z",
    lastSeenAt: "2026-11-09T15:15:00Z",
  });
  await insertAlert("upcoming-then-active", {
    effect: "SHUTTLE",
    routes: ["Red"],
    periods: [{ start: "2026-11-10T20:00:00Z", end: null }],
    firstSeenAt: "2026-11-08T12:00:00Z",
    lastSeenAt: "2026-11-11T02:30:00Z",
  });
  await insertAlert("notice-overlap", {
    effect: "STATION_ISSUE",
    routes: ["Red"],
    periods: [{ start: "2026-11-01T00:00:00Z", end: null }],
    firstSeenAt: "2026-11-09T14:10:00Z",
    lastSeenAt: "2026-11-10T21:00:00Z",
    inFeed: true,
  });
  // 夏時間が終わる日（運行日 10-31 は 25 時間）
  await insertAlert("dst", {
    routes: ["Blue"],
    periods: [{ start: "2026-11-01T05:30:00Z", end: "2026-11-01T06:45:00Z" }],
    firstSeenAt: "2026-10-31T00:00:00Z",
    lastSeenAt: "2026-11-02T00:00:00Z",
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("アラートの集計 SQL と TypeScript 版の一致", () => {
  it("フィクスチャの日（1 回だけ観測）", async () => {
    const ts = await expectSameAsTypeScript("2026-11-02");
    // 観測した 15:20:00Z ちょうどの 1 分だけ。予告のアラートは数えない
    expect(ts.daily.length).toBeGreaterThan(0);
    for (const d of ts.daily) expect(d.activeMinutes).toBe(d.alertCount);
    expect(ts.daily.map((d) => d.effect)).not.toContain("SUSPENSION");
  });

  it("複数の路線・重なる区間・遅延系とお知らせ系", async () => {
    const ts = await expectSameAsTypeScript("2026-11-09");
    const green = ts.daily.filter((d) => d.routeId.startsWith("Green"));
    expect(green.map((d) => [d.routeId, d.activeMinutes])).toEqual([
      ["Green-B", 135],
      ["Green-C", 135],
      ["Green-D", 135],
    ]);
    expect(
      ts.daily.filter((d) => d.routeId === "All").map((d) => [d.effect, d.alertCount]),
    ).toEqual([
      ["DELAY", 1],
      ["STATION_ISSUE", 1],
    ]);
  });

  it("予告だった日は数えず、有効になった日から数える", async () => {
    expect(
      (await expectSameAsTypeScript("2026-11-09")).daily.some((d) => d.effect === "SHUTTLE"),
    ).toBe(false);
    const day10 = await expectSameAsTypeScript("2026-11-10");
    // 15:00 ET（20:00Z）から 21:30 ET（11-11 02:30Z。ちょうどを含む）まで = 391 分
    expect(day10.daily.find((d) => d.routeId === "Red" && d.effect === "SHUTTLE")).toMatchObject({
      alertCount: 1,
      activeMinutes: 391,
    });
  });

  it("夏時間が終わる日の 1 時台（2 回ある）をまとめる", async () => {
    const ts = await expectSameAsTypeScript("2026-10-31");
    // EDT 01:30 〜 EST 01:45 = 75 分。すべて 1 時台
    expect(ts.hourly.filter((h) => h.routeId === "Blue")).toEqual([
      { routeId: "Blue", hour: 1, category: "disruption", activeMinutes: 75 },
    ]);
  });

  it("アラートのない日は行がない", async () => {
    expect(await expectSameAsTypeScript("2026-12-01")).toEqual({ daily: [], hourly: [] });
  });
});
