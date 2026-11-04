// 003 TR-002・TR-003: 運行間隔の集計 SQL と TypeScript 版が、同じデータで同じ結果になる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeHeadwayStats, insertHeadwayStats } from "@/lib/db/analytics-sql";
import { ensurePartitions } from "@/lib/db/partitions";
import { stationIdsOf } from "@/lib/db/static-read";
import {
  gapBaselines,
  greenTrunkStopsOf,
  headwayStats,
  type HeadwayArrival,
  type HeadwayStatRow,
} from "@/lib/metrics/headways";
import { addServiceDays, serviceDateToDbDate, type ServiceDate } from "@/lib/time";
import { insertAnalyticsSeed } from "../../helpers/analytics-seed";
import { createTestDb, resetData } from "../../helpers/db";
import { seedStaticFromFixtures } from "../../helpers/seed";

const db = createTestDb();

async function trunk(): Promise<Set<string>> {
  const patterns = await db.routePattern.findMany();
  return greenTrunkStopsOf(patterns.map((p) => ({ ...p, stationIds: stationIdsOf(p.stationIds) })));
}

async function arrivalsOf(serviceDate: ServiceDate): Promise<HeadwayArrival[]> {
  return db.arrivalEvent.findMany({
    where: { serviceDate: serviceDateToDbDate(serviceDate) },
    select: { routeId: true, directionId: true, stopId: true, arrivedAt: true },
  });
}

async function history() {
  const rows = await db.dailyHeadwayStat.findMany();
  return rows.map((r) => ({ ...r, serviceDate: r.serviceDate.toISOString().slice(0, 10) }));
}

/** SQL と TypeScript 版の結果を比べる（浮動小数は 1e-6 秒まで） */
async function expectSameAsTypeScript(serviceDate: ServiceDate): Promise<HeadwayStatRow[]> {
  const sql = await computeHeadwayStats(db, serviceDate);
  const ts = headwayStats(await arrivalsOf(serviceDate), {
    greenTrunkStops: await trunk(),
    baseline: gapBaselines(await history(), serviceDate),
  });
  const fromSql: HeadwayStatRow[] = sql.map((r) => ({
    routeId: r.route_id,
    directionId: r.direction_id,
    stopId: r.stop_id,
    hour: r.hour,
    n: r.n,
    meanSec: r.mean_sec,
    p50Sec: r.p50_sec,
    p90Sec: r.p90_sec,
    maxSec: r.max_sec,
    bunchingCount: r.bunching_count,
    gapCount: r.gap_count,
  }));
  // 並び順の規則が SQL（バイト順）と localeCompare で違いうるので、キーで並べ直して比べる
  const key = (r: HeadwayStatRow) => `${r.routeId}|${r.directionId}|${r.stopId}|${r.hour}`;
  const sortRows = (rows: HeadwayStatRow[]) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  const a = sortRows(fromSql);
  const b = sortRows(ts);
  expect(a.map(key)).toEqual(b.map(key));
  a.forEach((row, i) => {
    const t = b[i]!;
    expect(row).toMatchObject({
      n: t.n,
      maxSec: t.maxSec,
      bunchingCount: t.bunchingCount,
      gapCount: t.gapCount,
    });
    expect(row.meanSec).toBeCloseTo(t.meanSec, 6);
    expect(row.p50Sec).toBeCloseTo(t.p50Sec, 6);
    expect(row.p90Sec).toBeCloseTo(t.p90Sec, 6);
  });
  return a;
}

async function insertArrivals(
  serviceDate: ServiceDate,
  rows: { routeId: string; stopId: string; arrivedAt: string }[],
) {
  await ensurePartitions(db, [serviceDate]);
  await db.arrivalEvent.createMany({
    data: rows.map((r, i) => ({
      serviceDate: serviceDateToDbDate(serviceDate),
      tripId: `t${i}`,
      stopId: r.stopId,
      routeId: r.routeId,
      directionId: 0,
      vehicleId: null,
      arrivedAt: new Date(r.arrivedAt),
      source: "stopped_at",
      precisionSec: 60,
    })),
  });
}

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("運行間隔の集計 SQL と TypeScript 版の一致", () => {
  it("テスト用データの 1 日（Green の幹線の合算を含む）", async () => {
    await insertAnalyticsSeed(db, "2026-11-02", "2026-11-02");
    const rows = await expectSameAsTypeScript("2026-11-02");
    const routes = new Set(rows.map((r) => r.routeId));
    expect(routes).toEqual(new Set(["Red", "Green-B", "Green-C", "Green-D", "Green-E", "Green"]));
    // 合算した Green は 3 分ごと
    const green = rows.filter((r) => r.routeId === "Green" && r.hour === 10);
    expect(green.length).toBeGreaterThan(0);
    for (const r of green) expect(r.p50Sec).toBeLessThan(4 * 60);
    expect(rows.reduce((s, r) => s + r.bunchingCount, 0)).toBeGreaterThan(0);
  });

  it("前の日の集計結果を基準に、間隔の開きを数える（同じ曜日種別だけ）", async () => {
    // 10-26（月）〜 11-01（日）を集計してから、11-03（火）を比べる
    await insertAnalyticsSeed(db, "2026-10-26", "2026-11-03");
    for (let d = "2026-10-26"; d <= "2026-11-02"; d = addServiceDays(d, 1)) {
      await db.dailyHeadwayStat.deleteMany({ where: { serviceDate: serviceDateToDbDate(d) } });
      await insertHeadwayStats(db, d);
    }
    const rows = await expectSameAsTypeScript("2026-11-03");
    // 14 時台の 18 分の間隔は、基準（6 分前後）の 2 倍を超える
    const gaps = rows.filter((r) => r.routeId === "Red" && r.gapCount > 0);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((r) => r.hour === 14)).toBe(true);
  });

  it("運行日の終わり（ET 02:xx）の到着は、その運行日の 2 時台", async () => {
    // 運行日 11-10 の終わり: 11-11 の 02:30 と 02:50 ET（EST: UTC-5）
    await insertArrivals("2026-11-10", [
      { routeId: "Red", stopId: "place-alfcl", arrivedAt: "2026-11-11T07:30:00Z" },
      { routeId: "Red", stopId: "place-alfcl", arrivedAt: "2026-11-11T07:50:00Z" },
    ]);
    const rows = await expectSameAsTypeScript("2026-11-10");
    expect(rows.map((r) => [r.hour, r.n])).toEqual([[2, 1]]);
  });

  it("夏時間が終わる日（25 時間の運行日）の 1 時台をまとめる", async () => {
    // 運行日 10-31 の終わり = 11-01 の 01:xx が 2 回（EDT と EST）
    await insertArrivals("2026-10-31", [
      { routeId: "Blue", stopId: "place-wondl", arrivedAt: "2026-11-01T05:40:00Z" }, // EDT 01:40
      { routeId: "Blue", stopId: "place-wondl", arrivedAt: "2026-11-01T06:05:00Z" }, // EST 01:05
      { routeId: "Blue", stopId: "place-wondl", arrivedAt: "2026-11-01T06:30:00Z" }, // EST 01:30
      { routeId: "Blue", stopId: "place-wondl", arrivedAt: "2026-11-01T07:05:00Z" }, // EST 02:05
    ]);
    const rows = (await expectSameAsTypeScript("2026-10-31")).filter((r) => r.routeId === "Blue");
    expect(rows.map((r) => [r.hour, r.n])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it("到着が 0 件の日は行がない", async () => {
    await ensurePartitions(db, ["2026-11-20"]);
    expect(await expectSameAsTypeScript("2026-11-20")).toEqual([]);
  });
});
