// 005 T038: 分岐・合流と停車順を、画像や DB に依存せず確かめる。
import { describe, expect, it } from "vitest";
import { buildStripMaps, type StripBlock } from "@/lib/display/strip-map";
import type { StopsResponse } from "@/lib/api-schemas/stops";

type Pattern = { routeId: string; routePatternId: string; stationIds: string[] };
function input(patterns: Pattern[]): Pick<StopsResponse, "routes" | "patterns"> {
  return {
    patterns,
    routes: [...new Set(patterns.map((p) => p.routeId))].map((routeId) => ({
      routeId,
      routeName: `${routeId} Line`,
      routeColor: "000000",
      stations: [
        ...new Set(patterns.filter((p) => p.routeId === routeId).flatMap((p) => p.stationIds)),
      ].map((id) => ({ id, name: id, lat: null, lon: null })),
    })),
  };
}
function segments(blocks: readonly StripBlock[]): Extract<StripBlock, { kind: "segment" }>[] {
  return blocks.flatMap((b) =>
    b.kind === "segment" ? [b] : b.branches.flatMap((branch) => segments(branch.blocks)),
  );
}
function stations(blocks: readonly StripBlock[]): string[] {
  return segments(blocks).flatMap((s) => s.stationIds);
}
function pattern(routeId: string, stationIds: string[], suffix = "0"): Pattern {
  return { routeId, routePatternId: `${routeId}-${suffix}`, stationIds };
}
function assertPatterns(blocks: StripBlock[], patterns: Pattern[]) {
  const all = stations(blocks);
  expect(new Set(all).size).toBe(all.length);
  expect([...all].sort()).toEqual([...new Set(patterns.flatMap((p) => p.stationIds))].sort());
  for (const p of patterns) {
    expect(
      segments(blocks)
        .filter((s) => s.patternIds.includes(p.routePatternId))
        .flatMap((s) => s.stationIds),
    ).toEqual(p.stationIds);
  }
}

describe("buildStripMaps", () => {
  it("Orange は停車順の一本の線になる", () => {
    const patterns = [pattern("Orange", ["Oak Grove", "North Station", "Forest Hills"])];
    const [line] = buildStripMaps(input(patterns));
    expect(line?.routeId).toBe("Orange");
    expect(line?.blocks).toHaveLength(1);
    expect(stations(line!.blocks)).toEqual(patterns[0]!.stationIds);
    assertPatterns(line!.blocks, patterns);
  });

  it("Red は JFK/UMass までを一回だけ描き、Ashmont と Braintree に分ける", () => {
    const patterns = [
      pattern("Red", ["Alewife", "Park Street", "JFK/UMass", "Ashmont"], "ashmont"),
      pattern("Red", ["Alewife", "Park Street", "JFK/UMass", "Quincy", "Braintree"], "braintree"),
    ];
    const [line] = buildStripMaps(input(patterns));
    expect(line!.blocks[0]).toMatchObject({
      kind: "segment",
      stationIds: ["Alewife", "Park Street", "JFK/UMass"],
    });
    expect(line!.blocks[1]).toMatchObject({ kind: "branches", joins: false });
    assertPatterns(line!.blocks, patterns);
  });

  it("Green は北の合流、Copley の E、Kenmore の B/C/D を保ち、全駅が一回ずつ出る", () => {
    const common = ["Government Center", "Park Street", "Copley"];
    const patterns = [
      pattern("Green-B", [...common, "Hynes", "Kenmore", "Boston College"]),
      pattern("Green-C", [...common, "Hynes", "Kenmore", "Cleveland Circle"]),
      pattern("Green-D", ["Union Square", "Lechmere", ...common, "Hynes", "Kenmore", "Riverside"]),
      pattern("Green-E", [
        "Medford/Tufts",
        "Ball Square",
        "Lechmere",
        ...common,
        "Prudential",
        "Heath Street",
      ]),
    ];
    const [line] = buildStripMaps(input(patterns));
    expect(line!.routeId).toBe("Green");
    expect(line!.blocks[0]).toMatchObject({ kind: "branches", joins: true });
    const south = line!.blocks.at(-1)!;
    expect(south).toMatchObject({ kind: "branches", joins: false });
    if (south.kind !== "branches") throw new Error("missing Copley fork");
    const bcd = south.branches.find((b) => b.routeIds.includes("Green-B"))!;
    expect(bcd.blocks[0]).toMatchObject({ kind: "segment", stationIds: ["Hynes", "Kenmore"] });
    expect(bcd.blocks[1]).toMatchObject({
      kind: "branches",
      branches: [{ routeIds: ["Green-B"] }, { routeIds: ["Green-C"] }, { routeIds: ["Green-D"] }],
    });
    assertPatterns(line!.blocks, patterns);
  });

  it("入力を変更せず、パターンの入力順で図が変わらない", () => {
    const source = input([
      pattern("Red", ["a", "b", "c"], "1"),
      pattern("Red", ["a", "b", "d"], "2"),
    ]);
    const before = structuredClone(source);
    expect(buildStripMaps(source)).toEqual(
      buildStripMaps({ ...source, patterns: [...source.patterns].reverse() }),
    );
    expect(source).toEqual(before);
  });

  it("親駅一覧にない ID と重複を除き、空の応答は空の図になる", () => {
    const source = input([pattern("Orange", ["a", "a", "unknown", "b"])]);
    source.routes[0]!.stations = source.routes[0]!.stations.filter((s) => s.id !== "unknown");
    const [line] = buildStripMaps(source);
    expect(stations(line!.blocks)).toEqual(["a", "b"]);
    expect(buildStripMaps({ routes: [], patterns: [] })).toEqual([]);
  });
});
