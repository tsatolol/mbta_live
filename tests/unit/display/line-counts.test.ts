import { describe, expect, it } from "vitest";
import { lineCounts } from "@/lib/display/line-counts";

describe("路線ごとの列車数", () => {
  const routes = [
    { id: "Blue", sortOrder: 4 },
    { id: "Red", sortOrder: 1 },
    { id: "Orange", sortOrder: 3 },
  ];
  it("路線順に並べ、0 件の路線を残し、更新の止まった列車も数える", () => {
    expect(
      lineCounts(routes, [
        { routeId: "Red", isStale: false },
        { routeId: "Red", isStale: true },
        { routeId: "Blue", isStale: false },
      ]),
    ).toEqual({
      lines: [
        { id: "Red", count: 2 },
        { id: "Orange", count: 0 },
        { id: "Blue", count: 1 },
      ],
      total: 3,
    });
    expect(routes[0]?.id).toBe("Blue");
  });
  it("車両がなくてもすべての路線を返す", () => {
    expect(lineCounts(routes, []).total).toBe(0);
    expect(lineCounts(routes, []).lines.every((r) => r.count === 0)).toBe(true);
  });
  it("対象の路線だけを合計し、路線がなければ空を返す", () => {
    expect(lineCounts(routes, [{ routeId: "unknown" }]).total).toBe(0);
    expect(lineCounts([], [{ routeId: "Red" }])).toEqual({ lines: [], total: 0 });
  });
});
