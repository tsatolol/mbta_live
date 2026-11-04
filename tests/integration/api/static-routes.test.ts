// 002 TR-001: GET /api/static/routes
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getRoutes } from "@/lib/api/static-routes";
import { routesResponseSchema } from "@/lib/api-schemas/routes";
import { createTestDb, resetData } from "../../helpers/db";
import { LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
const handler = getRoutes({ db, clock: fixedClock(LIVE_RECORDED_AT) });

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/static/routes", () => {
  it("8 路線を並び順で返し、応答が共有のスキーマで解析できる", async () => {
    const res = await handler();
    expect(res.status).toBe(200);
    const body = routesResponseSchema.parse(await res.json());
    expect(body.routes.map((r) => r.id)).toEqual([
      "Red",
      "Mattapan",
      "Orange",
      "Green-B",
      "Green-C",
      "Green-D",
      "Green-E",
      "Blue",
    ]);
    expect(body.routes.find((r) => r.id === "Orange")).toMatchObject({
      color: "ED8B00",
      directionDestinations: ["Forest Hills", "Oak Grove"],
    });
  });

  it("路線・方向ごとの canonical な形状が GeoJSON で入る（Red は分岐で方向ごとに 2 つ）", async () => {
    const body = routesResponseSchema.parse(await (await handler()).json());
    const count = (routeId: string, directionId: number) =>
      body.shapes.features.filter(
        (f) => f.properties.routeId === routeId && f.properties.directionId === directionId,
      ).length;
    expect(count("Red", 0)).toBe(2);
    expect(count("Red", 1)).toBe(2);
    expect(count("Orange", 0)).toBe(1);
    expect(count("Blue", 1)).toBe(1);
    for (const f of body.shapes.features) {
      expect(f.geometry.coordinates.length).toBeGreaterThan(10);
      expect(f.properties.color).toBe(
        body.routes.find((r) => r.id === f.properties.routeId)?.color,
      );
    }
  });
});
