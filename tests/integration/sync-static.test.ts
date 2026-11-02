// US4: sync-static の結合テスト
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { createMbtaClient } from "@/lib/mbta/client";
import { runSyncStatic } from "@/jobs/sync-static";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { fixtureFetch } from "../helpers/fixture-fetch";

const db = createTestDb();
const NOW = new Date("2026-11-03T09:00:00Z"); // 04:00 ET

async function sync(overrides: Record<string, unknown> = {}) {
  const fetch = fixtureFetch(overrides);
  const client = createMbtaClient({ fetch });
  const result = await runSyncStatic({
    db,
    client,
    clock: fixedClock(NOW),
    connectionString: testDatabaseUrl(),
  });
  return { result, fetch, client };
}

async function counts() {
  return {
    routes: await db.route.count(),
    stations: await db.stop.count({ where: { locationType: 1 } }),
    platforms: await db.stop.count({ where: { locationType: 0 } }),
    patterns: await db.routePattern.count(),
    canonicalPatterns: await db.routePattern.count({ where: { typicality: 1 } }),
  };
}

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sync-static", () => {
  it("路線・駅・路線パターンを保存し、実行結果を記録する。リクエストは 4 つ", async () => {
    const { result, client } = await sync();
    expect(result).toMatchObject({ status: "success", exitCode: 0 });
    expect(await counts()).toEqual({
      routes: 8,
      stations: 125,
      platforms: 265 + 12,
      patterns: 37,
      canonicalPatterns: 18,
    });
    expect(client.requestCount).toBe(4);
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ job: "sync-static", status: "success", ratelimitRemaining: 15 });
    expect(run.counts).toMatchObject({
      routes: 8,
      stops: 125 + 265 + 12,
      routePatterns: 37,
      requests: 4,
    });
  });

  it("2 回実行しても件数は変わらない", async () => {
    await sync();
    await sync();
    expect(await counts()).toEqual({
      routes: 8,
      stations: 125,
      platforms: 277,
      patterns: 37,
      canonicalPatterns: 18,
    });
  });

  it("終点の番線も親駅に対応づき、路線パターンの停車順は親駅に変換される", async () => {
    await sync();
    expect((await db.stop.findUniqueOrThrow({ where: { id: "Alewife-01" } })).parentStationId).toBe(
      "place-alfcl",
    );
    const red = await db.routePattern.findFirstOrThrow({
      where: { routeId: "Red", typicality: 1, directionId: 0 },
    });
    const stations = red.stationIds as string[];
    expect(stations[0]).toBe("place-alfcl");
    expect(stations.every((s) => s.startsWith("place-"))).toBe(true);
  });

  it("今回の応答にない路線パターンは削除する（古い停車順を到着検出に使わないため）", async () => {
    await db.routePattern.create({
      data: {
        id: "Red-old-0",
        routeId: "Red",
        directionId: 0,
        name: "old",
        typicality: 1,
        canonical: true,
        platformStopIds: [],
        stationIds: [],
      },
    });
    await sync();
    expect(await db.routePattern.findUnique({ where: { id: "Red-old-0" } })).toBeNull();
  });

  it("未解決の駅 ID: ①② で見つかったものは解決済みにし、残りは ③ で取得する", async () => {
    await db.unknownStopId.createMany({
      data: [
        { stopId: "Alewife-01", firstSeenAt: new Date("2026-11-02T15:00:00Z") },
        { stopId: "70999", firstSeenAt: new Date("2026-11-02T15:00:00Z") },
        { stopId: "does-not-exist", firstSeenAt: new Date("2026-11-02T15:00:00Z") },
      ],
    });
    // ③ の応答: 新しいホーム 70999（親駅は Alewife）だけが返る
    const byId = {
      data: [
        {
          id: "70999",
          type: "stop",
          attributes: {
            name: "Alewife",
            latitude: 42.3959,
            longitude: -71.1424,
            location_type: 0,
            platform_name: "Track 3",
            vehicle_type: 1,
          },
          relationships: { parent_station: { data: { id: "place-alfcl", type: "stop" } } },
        },
      ],
    };
    const { client } = await sync({ "stops-by-id": byId });
    expect(client.requestCount).toBe(5);
    const unknown = await db.unknownStopId.findMany({ orderBy: { stopId: "asc" } });
    expect(unknown.map((u) => [u.stopId, u.resolvedAt?.toISOString() ?? null])).toEqual([
      ["70999", NOW.toISOString()],
      ["Alewife-01", NOW.toISOString()],
      ["does-not-exist", null],
    ]);
    expect((await db.stop.findUniqueOrThrow({ where: { id: "70999" } })).parentStationId).toBe(
      "place-alfcl",
    );
  });

  it("取得の途中で失敗したら何も書き込まない", async () => {
    const fetch = fixtureFetch();
    fetch.mockImplementation(async (input) =>
      input.pathname === "/route_patterns"
        ? new Response("{}", { status: 503 })
        : new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const client = createMbtaClient({ fetch });
    const result = await runSyncStatic({
      db,
      client,
      clock: fixedClock(NOW),
      connectionString: testDatabaseUrl(),
    });
    expect(result.status).toBe("failed");
    expect(await db.route.count()).toBe(0);
  });
});
