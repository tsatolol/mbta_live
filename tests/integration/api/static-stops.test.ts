// 002 TR-001: GET /api/static/stops
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getStops } from "@/lib/api/static-stops";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { stopsResponseSchema } from "@/lib/api-schemas/stops";
import { createTestDb, resetData } from "../../helpers/db";
import { apiRequest, LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
const handler = getStops({ db, clock: fixedClock(LIVE_RECORDED_AT) });

async function call(query = "") {
  const res = await handler(apiRequest(`/api/static/stops${query}`));
  return { res, body: (await res.json()) as unknown };
}

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/static/stops", () => {
  it("8 路線の親駅を路線の並び順で返し、応答が共有のスキーマで解析できる", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { routes, lastCollectedAt } = stopsResponseSchema.parse(body);
    expect(lastCollectedAt).not.toBeNull();
    expect(routes.map((r) => r.routeId)).toEqual([
      "Red",
      "Mattapan",
      "Orange",
      "Green-B",
      "Green-C",
      "Green-D",
      "Green-E",
      "Blue",
    ]);
    for (const r of routes) {
      expect(r.stations.length).toBeGreaterThan(0);
      // 親駅だけ（重複なし）
      expect(new Set(r.stations.map((s) => s.id)).size).toBe(r.stations.length);
      for (const s of r.stations) expect(s.id).toMatch(/^place-/);
    }
  });

  it("停車順に並び、分岐のある路線は両方の支線の駅を含む", async () => {
    const { body } = await call("?route=Red");
    const { routes } = stopsResponseSchema.parse(body);
    expect(routes).toHaveLength(1);
    const red = routes[0]!;
    expect(red.routeName).toBe("Red Line");
    expect(red.routeColor).toBe("DA291C");
    const names = red.stations.map((s) => s.name);
    expect(names[0]).toBe("Alewife");
    expect(names).toContain("Ashmont");
    expect(names).toContain("Braintree");
    expect(names.indexOf("Park Street")).toBeLessThan(names.indexOf("JFK/UMass"));
    expect(red.stations).toHaveLength(22);
  });

  it("複数の路線が通る駅は、それぞれの路線に出る", async () => {
    const { body } = await call();
    const { routes } = stopsResponseSchema.parse(body);
    const withParkStreet = routes
      .filter((r) => r.stations.some((s) => s.id === "place-pktrm"))
      .map((r) => r.routeId);
    expect(withParkStreet).toEqual(["Red", "Green-B", "Green-C", "Green-D", "Green-E"]);
  });

  it.each(["?route=Foo", "?route=", `?route=${"x".repeat(40)}`])(
    "不正な route（%s）で 400",
    async (query) => {
      const { res, body } = await call(query);
      expect(res.status).toBe(400);
      expect(errorResponseSchema.parse(body).error).toContain("route");
    },
  );
});
