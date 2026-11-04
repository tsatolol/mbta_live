// 002 TR-001: GET /api/live/predictions（駅の到着表示）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getPredictions } from "@/lib/api/live-predictions";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { predictionsResponseSchema } from "@/lib/api-schemas/predictions";
import { createTestDb, resetData } from "../../helpers/db";
import { apiRequest, LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
// 記録の 1 分後
const now = new Date(LIVE_RECORDED_AT.getTime() + 60_000);
const handler = getPredictions({ db, clock: fixedClock(now) });

async function call(query: string) {
  const res = await handler(apiRequest(`/api/live/predictions${query}`));
  return { res, body: (await res.json()) as unknown };
}

async function board(stop: string) {
  const { res, body } = await call(`?stop=${stop}`);
  expect(res.status).toBe(200);
  return predictionsResponseSchema.parse(body);
}

/** Downtown Crossing の Orange 方向 0 の、これから来る便（時刻の順） */
async function upcomingAtDowntownCrossing() {
  const platforms = await db.stop.findMany({
    where: { parentStationId: "place-dwnxg" },
    select: { id: true },
  });
  return db.predictionCurrent.findMany({
    where: {
      stopId: { in: platforms.map((p) => p.id) },
      routeId: "Orange",
      directionId: 0,
      arrivalTime: { gt: now },
    },
    orderBy: { arrivalTime: "asc" },
  });
}

let skippedTrip: string;
let cancelledTrip: string;
let pastTrip: string;

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
  // 通過（SKIPPED）・運休（CANCELLED）・予定時刻が過ぎた便を作る
  const [first, second, third] = await upcomingAtDowntownCrossing();
  if (!first || !second || !third) throw new Error("フィクスチャにこれから来る便が足りません");
  skippedTrip = first.tripId;
  cancelledTrip = second.tripId;
  pastTrip = third.tripId;
  await db.predictionCurrent.update({
    where: { id: first.id },
    data: { scheduleRelationship: "SKIPPED" },
  });
  await db.predictionCurrent.update({
    where: { id: second.id },
    data: { scheduleRelationship: "CANCELLED" },
  });
  await db.predictionCurrent.update({
    where: { id: third.id },
    data: { arrivalTime: new Date(now.getTime() - 30_000) },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/live/predictions", () => {
  it("親駅のホームの予測を、路線・方向ごとに時刻の順で次の 3 本返す", async () => {
    const res = await board("place-pktrm");
    expect(res.stop).toEqual({ id: "place-pktrm", name: "Park Street" });
    expect(res.lastCollectedAt).not.toBeNull();
    expect(res.generatedAt).toBe(now.toISOString());
    expect(res.directions.map((d) => `${d.routeId}:${d.directionId}`)).toEqual([
      "Red:0",
      "Red:1",
      "Green-B:0",
      "Green-B:1",
      "Green-C:0",
      "Green-C:1",
      "Green-D:0",
      "Green-D:1",
      "Green-E:0",
      "Green-E:1",
    ]);
    for (const d of res.directions) {
      expect(d.arrivals.length).toBeGreaterThan(0);
      expect(d.arrivals.length).toBeLessThanOrEqual(3);
      const times = d.arrivals.map((a) => Date.parse(a.time));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const t of times) expect(t).toBeGreaterThan(now.getTime());
    }
  });

  it("方向の名前と行先は路線の direction_names / direction_destinations から付ける", async () => {
    const res = await board("place-pktrm");
    const red0 = res.directions.find((d) => d.routeId === "Red" && d.directionId === 0);
    expect(red0).toMatchObject({
      routeColor: "DA291C",
      directionName: "South",
      destination: "Ashmont/Braintree",
    });
    const red1 = res.directions.find((d) => d.routeId === "Red" && d.directionId === 1);
    expect(red1).toMatchObject({ directionName: "North", destination: "Alewife" });
  });

  it("SKIPPED と予定時刻が過ぎた便は除き、運休の便は cancelled として返す", async () => {
    const res = await board("place-dwnxg");
    const orange0 = res.directions.find((d) => d.routeId === "Orange" && d.directionId === 0);
    const trips = orange0?.arrivals.map((a) => a.tripId) ?? [];
    expect(trips).not.toContain(skippedTrip);
    expect(trips).not.toContain(pastTrip);
    const cancelled = orange0?.arrivals.find((a) => a.tripId === cancelledTrip);
    expect(cancelled?.cancelled).toBe(true);
    expect(orange0?.arrivals.filter((a) => a.cancelled)).toHaveLength(1);
  });

  it("始発駅では出発時刻を使い、終点となる方向は出さない", async () => {
    const res = await board("place-alfcl");
    expect(res.directions.map((d) => `${d.routeId}:${d.directionId}`)).toEqual(["Red:0"]);
    const arrivals = res.directions[0]!.arrivals;
    expect(arrivals.length).toBeGreaterThan(0);
    for (const a of arrivals) expect(a.timeKind).toBe("departure");
  });

  it("その駅と、その駅を通る路線に有効なアラートを返す", async () => {
    // Jackson Square: 駅のアラート（STATION_ISSUE）が 2 件ある
    const jackson = await board("place-jaksn");
    expect(jackson.alerts.map((a) => a.id).sort()).toEqual(["1001814", "1001861"]);
    for (const a of jackson.alerts) {
      expect(a.status).toBe("active");
      expect(a.routeIds).toContain("Orange");
    }
    // ほかの駅だけのアラートは出ない
    const park = await board("place-pktrm");
    expect(park.alerts.map((a) => a.id)).not.toContain("1001861");
  });

  it("まだ始まっていないアラートは出さない", async () => {
    // JFK/UMass: 予告の SHUTTLE（1039759）だけがある
    const jfk = await board("place-jfk");
    expect(jfk.alerts.map((a) => a.id)).not.toContain("1039759");
  });

  it.each(["", "?stop=", "?stop=bad%20id!", `?stop=${"x".repeat(80)}`])(
    "stop がない・不正（%s）で 400",
    async (query) => {
      const { res, body } = await call(query);
      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(body).error).toContain("stop");
    },
  );

  it.each(["place-nowhere", "70061"])("親駅でない stop（%s）で 404", async (stop) => {
    const { res, body } = await call(`?stop=${stop}`);
    expect(res.status).toBe(404);
    errorResponseSchema.parse(body);
  });
});
