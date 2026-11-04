// 003 TR-001: アラートの集計（TypeScript 版）
import { describe, expect, it } from "vitest";
import {
  ALL_ROUTES,
  alertCategoryOf,
  alertDayStats,
  serviceDayMinutes,
  summarizeAlertStats,
  type AlertForStats,
} from "@/lib/metrics/alert-stats";

// 運行日 2026-11-10（火）は 11-10 08:00Z（03:00 ET）〜 11-11 08:00Z
const t = (iso: string) => new Date(iso);

function alert(over: Partial<AlertForStats> = {}): AlertForStats {
  return {
    id: "a1",
    effect: "DELAY",
    cause: "SIGNAL_PROBLEM",
    firstSeenAt: t("2026-11-01T00:00:00Z"),
    lastSeenAt: t("2026-11-30T00:00:00Z"),
    // 10:00〜11:30 ET
    activePeriod: [{ start: t("2026-11-10T15:00:00Z"), end: t("2026-11-10T16:30:00Z") }],
    routeIds: ["Red"],
    ...over,
  };
}

describe("serviceDayMinutes", () => {
  it("ふつうの日は 1,440 分、夏時間が終わる日は 1,500 分、始まる日は 1,380 分", () => {
    expect(serviceDayMinutes("2026-11-10")).toHaveLength(1440);
    expect(serviceDayMinutes("2026-10-31")).toHaveLength(1500);
    expect(serviceDayMinutes("2027-03-13")).toHaveLength(1380);
  });
});

describe("alertCategoryOf", () => {
  it.each([
    ["DELAY", "disruption"],
    ["SUSPENSION", "disruption"],
    ["SHUTTLE", "disruption"],
    ["STATION_CLOSURE", "disruption"],
    ["NOTICE", "notice"],
    ["STATION_ISSUE", "notice"],
    ["SOMETHING_NEW", "notice"],
  ])("%s は %s", (effect, category) => {
    expect(alertCategoryOf(effect)).toBe(category);
  });
});

describe("alertDayStats", () => {
  it("有効な分数と件数。路線ごとと、路線をまとめた All", () => {
    const { daily, hourly } = alertDayStats([alert()], "2026-11-10");
    expect(daily).toEqual([
      {
        routeId: ALL_ROUTES,
        effect: "DELAY",
        cause: "SIGNAL_PROBLEM",
        alertCount: 1,
        activeMinutes: 90,
      },
      {
        routeId: "Red",
        effect: "DELAY",
        cause: "SIGNAL_PROBLEM",
        alertCount: 1,
        activeMinutes: 90,
      },
    ]);
    expect(hourly.filter((h) => h.routeId === "Red")).toEqual([
      { routeId: "Red", hour: 10, category: "disruption", activeMinutes: 60 },
      { routeId: "Red", hour: 11, category: "disruption", activeMinutes: 30 },
    ]);
  });

  it("フィードで観測していた間だけ数える（first_seen_at〜last_seen_at）", () => {
    const { daily } = alertDayStats(
      [alert({ firstSeenAt: t("2026-11-10T15:20:00Z"), lastSeenAt: t("2026-11-10T15:49:30Z") })],
      "2026-11-10",
    );
    // 10:20〜10:49 の分の始まり（10:49:00 は 10:49:30 以前なので含む）= 30 分
    expect(daily.find((d) => d.routeId === "Red")!.activeMinutes).toBe(30);
  });

  it("予告だけの日（観測はしたが、有効な区間がまだ始まっていない）は数えない", () => {
    const upcoming = alert({
      activePeriod: [{ start: t("2026-11-15T15:00:00Z"), end: null }],
    });
    expect(alertDayStats([upcoming], "2026-11-10")).toEqual({ daily: [], hourly: [] });
  });

  it("日をまたぐ区間は、その日に含まれる分だけ。終わりのない区間は観測の終わりまで", () => {
    const longRunning = alert({
      activePeriod: [{ start: t("2026-11-09T12:00:00Z"), end: null }],
      lastSeenAt: t("2026-11-10T17:00:00Z"), // 12:00 ET に消えた
    });
    const day10 = alertDayStats([longRunning], "2026-11-10").daily[0]!;
    // 03:00 ET（08:00Z）〜 12:00 ET（17:00Z）の分の始まり。17:00:00Z ちょうどを含む = 541 分
    expect(day10.activeMinutes).toBe(541);
    const day9 = alertDayStats([longRunning], "2026-11-09").daily[0]!;
    // 11-09 は 07:00 ET（12:00Z）から運行日の終わり（11-10 08:00Z）まで = 20 時間
    expect(day9.activeMinutes).toBe(20 * 60);
  });

  it("重なる区間は二重に数えない", () => {
    const overlapping = alert({
      activePeriod: [
        { start: t("2026-11-10T15:00:00Z"), end: t("2026-11-10T16:00:00Z") },
        { start: t("2026-11-10T15:30:00Z"), end: t("2026-11-10T16:30:00Z") },
      ],
    });
    expect(alertDayStats([overlapping], "2026-11-10").daily[0]!.activeMinutes).toBe(90);
  });

  it("複数の路線のアラートは路線ごとに 1 件、All には 1 件。時間帯の分数は同時の 2 件でも 1 分", () => {
    const { daily, hourly } = alertDayStats(
      [
        alert({ id: "a1", routeIds: ["Green-B", "Green-C"] }),
        alert({ id: "a2", routeIds: ["Green-B"], cause: "UNKNOWN_CAUSE" }),
      ],
      "2026-11-10",
    );
    const count = (routeId: string) =>
      daily.filter((d) => d.routeId === routeId).reduce((s, d) => s + d.alertCount, 0);
    expect(count("Green-B")).toBe(2);
    expect(count("Green-C")).toBe(1);
    expect(count(ALL_ROUTES)).toBe(2);
    // 10 時台: 2 件が同時に有効でも 60 分
    expect(hourly.find((h) => h.routeId === "Green-B" && h.hour === 10)!.activeMinutes).toBe(60);
  });

  it("遅延系とお知らせ系は時間帯の分数で分ける", () => {
    const { hourly } = alertDayStats(
      [alert({ id: "a1" }), alert({ id: "a2", effect: "STATION_ISSUE" })],
      "2026-11-10",
    );
    expect(
      hourly.filter((h) => h.routeId === "Red" && h.hour === 10).map((h) => h.category),
    ).toEqual(["disruption", "notice"]);
  });

  it("路線のないアラートは数えない", () => {
    expect(alertDayStats([alert({ routeIds: [] })], "2026-11-10").daily).toEqual([]);
  });
});

describe("summarizeAlertStats", () => {
  it("日別（行がない日は 0）、effect・cause ごと（分数の多い順）、区分ごとの合計", () => {
    const rows = [
      { serviceDate: "2026-11-09", effect: "DELAY", cause: "A", alertCount: 1, activeMinutes: 30 },
      {
        serviceDate: "2026-11-09",
        effect: "NOTICE",
        cause: "B",
        alertCount: 2,
        activeMinutes: 100,
      },
      {
        serviceDate: "2026-11-10",
        effect: "SHUTTLE",
        cause: "A",
        alertCount: 1,
        activeMinutes: 60,
      },
    ];
    const s = summarizeAlertStats(rows, ["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(s.daily).toEqual([
      {
        serviceDate: "2026-11-08",
        disruption: { alertCount: 0, activeMinutes: 0 },
        notice: { alertCount: 0, activeMinutes: 0 },
      },
      {
        serviceDate: "2026-11-09",
        disruption: { alertCount: 1, activeMinutes: 30 },
        notice: { alertCount: 2, activeMinutes: 100 },
      },
      {
        serviceDate: "2026-11-10",
        disruption: { alertCount: 1, activeMinutes: 60 },
        notice: { alertCount: 0, activeMinutes: 0 },
      },
    ]);
    expect(s.byEffect.map((e) => [e.effect, e.category, e.activeMinutes])).toEqual([
      ["NOTICE", "notice", 100],
      ["SHUTTLE", "disruption", 60],
      ["DELAY", "disruption", 30],
    ]);
    expect(s.byCause.map((c) => [c.cause, c.alertCount, c.activeMinutes])).toEqual([
      ["B", 2, 100],
      ["A", 2, 90],
    ]);
    expect(s.totals).toEqual({
      disruption: { alertCount: 2, activeMinutes: 90 },
      notice: { alertCount: 2, activeMinutes: 100 },
    });
  });
});
