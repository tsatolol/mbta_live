// アラートの画面の表示用の関数
import { describe, expect, it } from "vitest";
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { effectLabel, groupAlertsByRoutes, periodLabel } from "@/components/alerts/format";

function alert(id: string, routeIds: string[]): AlertItem {
  return {
    id,
    effect: "DELAY",
    cause: "UNKNOWN_CAUSE",
    severity: 5,
    header: id,
    shortHeader: null,
    description: null,
    serviceEffect: null,
    timeframe: null,
    lifecycle: "NEW",
    status: "active",
    activePeriod: [],
    routeIds,
    inFeed: true,
    updatedAt: null,
  };
}

const ORDER = ["Red", "Mattapan", "Orange", "Green-B", "Green-C", "Green-D", "Green-E", "Blue"];

describe("effectLabel", () => {
  it("effect を読みやすくする", () => {
    expect(effectLabel("STATION_ISSUE")).toBe("Station Issue");
    expect(effectLabel("DELAY")).toBe("Delay");
  });
});

describe("periodLabel", () => {
  it("ボストン時間で表示し、終わりのない区間は until further notice", () => {
    expect(periodLabel({ start: "2026-11-14T08:00:00Z", end: "2026-11-16T08:00:00Z" })).toBe(
      "Nov 14, 3:00 AM – Nov 16, 3:00 AM",
    );
    expect(periodLabel({ start: "2026-07-01T19:43:00Z", end: null })).toBe(
      "Jul 1, 3:43 PM – until further notice",
    );
  });
});

describe("groupAlertsByRoutes", () => {
  it("同じ路線の組み合わせを 1 つにまとめ、路線の並び順に並べる（中の順は保つ）", () => {
    const green = ["Green-B", "Green-C", "Green-D", "Green-E"];
    const groups = groupAlertsByRoutes(
      [
        alert("g1", green),
        alert("o1", ["Orange"]),
        alert("b1", ["Blue"]),
        alert("o2", ["Orange"]),
        alert("gb", ["Green-B"]),
        alert("r1", ["Red"]),
      ],
      ORDER,
    );
    expect(groups.map((g) => [g.routeIds.join(","), g.alerts.map((a) => a.id)])).toEqual([
      ["Red", ["r1"]],
      ["Orange", ["o1", "o2"]],
      ["Green-B", ["gb"]],
      [green.join(","), ["g1"]],
      ["Blue", ["b1"]],
    ]);
  });
});
