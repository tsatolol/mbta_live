// US2: 連続した収集で到着イベントが記録される（平日 12:28 ET からの 4 回分の実データ）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { createMbtaClient } from "@/lib/mbta/client";
import { parseVehicles } from "@/lib/mbta/schemas/vehicle";
import { STALE_VEHICLE_SEC } from "@/lib/metrics/constants";
import { serviceDateOf, serviceDateToDbDate } from "@/lib/time";
import { runCollect } from "@/jobs/collect";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { fakeMbtaFetch } from "../helpers/fake-mbta";
import { seedStaticFromFixtures } from "../helpers/seed";
import { loadSequence, type RecordedPoll } from "../helpers/sequence";

const db = createTestDb();
let polls: RecordedPoll[];
const runIds: number[] = [];

async function collectPoll(poll: RecordedPoll) {
  const client = createMbtaClient({ fetch: fakeMbtaFetch({ bodies: poll.bodies }) });
  return runCollect({
    db,
    client,
    clock: fixedClock(poll.polledAt),
    connectionString: testDatabaseUrl(),
  });
}

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
  polls = await loadSequence("20261102-1228");
  for (const poll of polls) {
    const result = await collectPoll(poll);
    expect(result.status).toBe("success");
    runIds.push(result.runId);
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("到着イベント", () => {
  it("記録される。駅はすべて親駅で、推定方法は 3 種類のどれか", async () => {
    const events = await db.arrivalEvent.findMany();
    expect(events.length).toBeGreaterThan(50);
    for (const e of events) {
      expect(e.stopId).toMatch(/^place-/);
      expect(["stopped_at", "predicted_last", "interpolated"]).toContain(e.source);
      expect(e.serviceDate).toEqual(serviceDateToDbDate(serviceDateOf(e.arrivedAt)));
    }
    // 取りこぼした駅も、前回の予測から記録される
    expect(events.some((e) => e.source === "predicted_last")).toBe(true);
  });

  it("各回で停車中だった営業中の車両には、その親駅への到着が記録されている", async () => {
    const parents = new Map(
      (await db.stop.findMany({ select: { id: true, parentStationId: true } })).map((s) => [
        s.id,
        s.parentStationId,
      ]),
    );
    const events = await db.arrivalEvent.findMany();
    const recorded = new Map(events.map((e) => [`${e.tripId}|${e.stopId}`, e]));
    let checked = 0;
    for (const poll of polls) {
      for (const v of parseVehicles(poll.bodies.vehicles).rows) {
        const fresh = poll.polledAt.getTime() - v.updatedAt.getTime() < STALE_VEHICLE_SEC * 1000;
        if (
          v.currentStatus !== "STOPPED_AT" ||
          !fresh ||
          v.revenue !== "REVENUE" ||
          !v.tripId ||
          !v.stopId
        )
          continue;
        const station = parents.get(v.stopId);
        if (!station) continue;
        const e = recorded.get(`${v.tripId}|${station}`);
        expect(e, `${v.vehicleId} ${v.tripId} ${station}`).toBeDefined();
        // 最初に記録した到着が残るので、停車を観測した時刻以前
        expect(e?.arrivedAt.getTime()).toBeLessThanOrEqual(v.updatedAt.getTime());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("到着時刻は記録した時間の範囲に収まる", async () => {
    const events = await db.arrivalEvent.findMany();
    const last = polls.at(-1)?.polledAt.getTime() ?? 0;
    const firstPoll = polls[0]?.polledAt.getTime() ?? 0;
    for (const e of events) {
      expect(e.arrivedAt.getTime()).toBeLessThanOrEqual(last);
      // 1 回目は前回がないので stopped_at だけ（更新が止まっていない車両なので 180 秒以内）
      expect(e.arrivedAt.getTime()).toBeGreaterThan(firstPoll - STALE_VEHICLE_SEC * 1000);
    }
  });

  it("実行記録の件数と一致し、未知の駅 ID はない", async () => {
    const runs = await db.collectorRun.findMany({ where: { id: { in: runIds } } });
    const counts = runs.map((r) => r.counts as Record<string, number>);
    expect(counts.reduce((sum, c) => sum + (c.arrivalsInserted ?? 0), 0)).toBe(
      await db.arrivalEvent.count(),
    );
    expect(counts.every((c) => c.unknownStopIds === 0)).toBe(true);
  });

  it("同じ回をもう一度流しても、到着イベントは増えない", async () => {
    const before = await db.arrivalEvent.count();
    const last = polls.at(-1);
    if (!last) throw new Error("記録がありません");
    const result = await collectPoll(last);
    expect(result.status).toBe("success");
    expect(await db.arrivalEvent.count()).toBe(before);
  });
});
