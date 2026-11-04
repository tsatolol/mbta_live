// 002 TR-001: GET /api/live/vehicles
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getVehicles } from "@/lib/api/live-vehicles";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { vehiclesResponseSchema } from "@/lib/api-schemas/vehicles";
import { createTestDb, resetData } from "../../helpers/db";
import { apiRequest, LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
// 記録の 1 分後
const clock = fixedClock(new Date(LIVE_RECORDED_AT.getTime() + 60_000));
const handler = getVehicles({ db, clock });

async function call(query = "") {
  const res = await handler(apiRequest(`/api/live/vehicles${query}`));
  return { res, body: (await res.json()) as unknown };
}

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/live/vehicles", () => {
  it("全路線の車両を返し、応答が共有のスキーマで解析できる", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const parsed = vehiclesResponseSchema.parse(body);
    expect(parsed.vehicles).toHaveLength(106);
    expect(parsed.lastCollectedAt).not.toBeNull();
    expect(parsed.generatedAt).toBe(clock.now().toISOString());
    expect(new Set(parsed.vehicles.map((v) => v.routeId))).toEqual(
      new Set(["Red", "Mattapan", "Orange", "Green-B", "Green-C", "Green-D", "Green-E", "Blue"]),
    );
  });

  it("路線の色・行先・次の駅の名前が付く", async () => {
    const { body } = await call("?routes=Red");
    const red = vehiclesResponseSchema.parse(body).vehicles;
    expect(red.length).toBeGreaterThan(0);
    for (const v of red) {
      expect(v.routeColor).toBe("DA291C");
      if (v.directionId !== null) expect(["Ashmont/Braintree", "Alewife"]).toContain(v.destination);
      // stop_id があれば親駅の名前、なければ null
      if (v.stopId === null) expect(v.stopName).toBeNull();
    }
    expect(red.some((v) => v.stopName !== null)).toBe(true);
  });

  it("routes で絞り込める（カンマ区切り）", async () => {
    const { body } = await call("?routes=Blue,Orange");
    const vehicles = vehiclesResponseSchema.parse(body).vehicles;
    expect(vehicles.length).toBeGreaterThan(0);
    expect(new Set(vehicles.map((v) => v.routeId))).toEqual(new Set(["Blue", "Orange"]));
  });

  it("isStale は updated_at が 3 分以上前のときだけ true", async () => {
    const { body } = await call();
    for (const v of vehiclesResponseSchema.parse(body).vehicles) {
      const age = clock.now().getTime() - Date.parse(v.updatedAt);
      expect(v.isStale).toBe(age >= 180_000);
    }
  });

  it("対象外の路線を指定すると 400", async () => {
    const { res, body } = await call("?routes=Red,CR-Fitchburg");
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(body).error).toContain("routes");
  });
});
