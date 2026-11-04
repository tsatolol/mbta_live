// 002 T005: 路線形状（encoded polyline）のデコード
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodePolyline } from "@/lib/geo/polyline";
import { latestFixtureFile } from "@/lib/mbta/client";

describe("decodePolyline", () => {
  it("Google の文書の例をデコードする（[lon, lat] の順）", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });

  it("空の文字列は空の配列", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("途中で終わった文字列は例外", () => {
    expect(() => decodePolyline("_p~iF~ps|U_")).toThrow();
  });

  it("フィクスチャの路線形状は、すべてボストン周辺の範囲に入る", async () => {
    const dir = path.join(import.meta.dirname, "../../fixtures/mbta");
    const doc = JSON.parse(
      await readFile(await latestFixtureFile(dir, "route-patterns"), "utf8"),
    ) as {
      included?: { type: string; attributes: { polyline?: string } }[];
    };
    const polylines = (doc.included ?? [])
      .filter((r) => r.type === "shape" && r.attributes.polyline)
      .map((r) => r.attributes.polyline as string);
    expect(polylines.length).toBeGreaterThan(10);
    for (const encoded of polylines) {
      const coords = decodePolyline(encoded);
      expect(coords.length).toBeGreaterThan(1);
      for (const [lon, lat] of coords) {
        expect(lon).toBeGreaterThan(-71.5);
        expect(lon).toBeLessThan(-70.8);
        expect(lat).toBeGreaterThan(42.0);
        expect(lat).toBeLessThan(42.6);
      }
    }
  });
});
