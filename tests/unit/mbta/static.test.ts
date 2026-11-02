// TR-001 の一部: 静的データ（路線・駅・路線パターン）の応答の解析
import { describe, expect, it } from "vitest";
import { parseRoutes } from "@/lib/mbta/schemas/route";
import { parseRoutePatterns } from "@/lib/mbta/schemas/route-pattern";
import { parseStopDocument, selectRapidTransitStops } from "@/lib/mbta/schemas/stop";
import { readFixture } from "../../helpers/fixtures";

const ROUTE_TYPE_STOPS = "stops-route-type-20261102-1020.json";
const CHILD_STOPS = "stops-child-stops-20261102-1020.json";

describe("parseRoutes", () => {
  it("対象 8 路線を、色・方向名・行先付きで解析する", async () => {
    const { rows, rejected } = parseRoutes(await readFixture("routes-20261101-0422.json"));
    expect(rejected).toEqual([]);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ["Blue", "Green-B", "Green-C", "Green-D", "Green-E", "Mattapan", "Orange", "Red"].sort(),
    );
    expect(rows.find((r) => r.id === "Red")).toMatchObject({
      color: "DA291C",
      textColor: "FFFFFF",
      directionNames: ["South", "North"],
      directionDestinations: ["Ashmont/Braintree", "Alewife"],
      longName: "Red Line",
      type: 1,
    });
  });
});

describe("駅", () => {
  it("① は data にホーム 265 件、included に親駅 125 件", async () => {
    const { data, included, rejected } = parseStopDocument(await readFixture(ROUTE_TYPE_STOPS));
    expect(rejected).toEqual([]);
    expect(data).toHaveLength(265);
    expect(data.every((s) => s.locationType === 0 && s.parentStationId?.startsWith("place-"))).toBe(
      true,
    );
    expect(included).toHaveLength(125);
    expect(included.every((s) => s.locationType === 1)).toBe(true);
  });

  it("② の child_stops から、地下鉄のホームだけを残すと終点の番線など 12 件が加わる", async () => {
    const first = parseStopDocument(await readFixture(ROUTE_TYPE_STOPS));
    const second = parseStopDocument(await readFixture(CHILD_STOPS));
    const selected = selectRapidTransitStops(second);
    const known = new Set(first.data.map((s) => s.id));
    const extra = selected.filter((s) => s.locationType === 0 && !known.has(s.id)).map((s) => s.id);
    expect(extra.sort()).toEqual(
      [
        "71199",
        "Alewife-01",
        "Alewife-02",
        "Braintree-01",
        "Braintree-02",
        "Forest Hills-01",
        "Forest Hills-02",
        "Government Center-Brattle",
        "Oak Grove-01",
        "Oak Grove-02",
        "Union Square-01",
        "Union Square-02",
      ].sort(),
    );
    // バス停・通勤鉄道・出入口などは残さない
    expect(
      selected.every((s) => s.locationType === 1 || s.vehicleType === 0 || s.vehicleType === 1),
    ).toBe(true);
    expect(selected.filter((s) => s.locationType === 1)).toHaveLength(125);
  });
});

describe("parseRoutePatterns", () => {
  it("Shuttle-* を除いた対象 8 路線のパターンを、停車順と形状付きで解析する", async () => {
    const { rows, rejected } = parseRoutePatterns(
      await readFixture("route-patterns-20261101-0423.json"),
    );
    expect(rejected).toEqual([]);
    expect(rows.some((p) => p.routeId.startsWith("Shuttle-"))).toBe(false);
    expect(rows).toHaveLength(37);
    expect(rows.filter((p) => p.typicality === 1)).toHaveLength(18);
    const red = rows.find((p) => p.routeId === "Red" && p.typicality === 1 && p.directionId === 0);
    expect(red?.platformStopIds[0]).toBe("70061");
    expect(red?.shapePolyline?.length).toBeGreaterThan(100);
  });

  it("代行バスだけのフィクスチャからは何も返さない", async () => {
    const { rows } = parseRoutePatterns(await readFixture("cases/route-patterns-shuttle.json"));
    expect(rows).toEqual([]);
  });
});
