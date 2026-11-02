// テスト用の静的データの投入（T022）が、実測した件数と対応になっていることを確かめる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, resetData } from "../helpers/db";
import { seedStaticFromFixtures } from "../helpers/seed";

const db = createTestDb();

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("seedStaticFromFixtures", () => {
  it("8 路線", async () => {
    expect(await db.route.count()).toBe(8);
  });

  it("親駅 125 件と、ホーム 265 件 + 終点の番線などの 12 件", async () => {
    expect(await db.stop.count({ where: { locationType: 1 } })).toBe(125);
    expect(await db.stop.count({ where: { locationType: 0 } })).toBe(265 + 12);
  });

  it("終点の番線も親駅に対応づく", async () => {
    const stop = await db.stop.findUniqueOrThrow({ where: { id: "Alewife-01" } });
    expect(stop.parentStationId).toBe("place-alfcl");
  });

  it("路線パターンは対象 8 路線だけ（Shuttle-* を除く）。通常運行は 18 件", async () => {
    expect(await db.routePattern.count({ where: { routeId: { startsWith: "Shuttle-" } } })).toBe(0);
    expect(await db.routePattern.count({ where: { typicality: 1 } })).toBe(18);
  });

  it("停車順は親駅に変換される", async () => {
    const pattern = await db.routePattern.findFirstOrThrow({
      where: { routeId: "Red", typicality: 1, directionId: 0 },
    });
    const stations = pattern.stationIds as string[];
    expect(stations[0]).toBe("place-alfcl");
    expect(stations.every((id) => id.startsWith("place-"))).toBe(true);
  });
});
