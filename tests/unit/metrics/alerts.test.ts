// 002 TR-002: アラートの状態と期間（時計を固定する）
import { describe, expect, it } from "vitest";
import { alertOverlaps, alertStatusOf, effectivePeriods } from "@/lib/metrics/alerts";

const d = (iso: string) => new Date(iso);
const now = d("2026-11-02T15:20:00Z");

describe("effectivePeriods", () => {
  it("フィードにあるアラートはそのまま", () => {
    const periods = [{ start: d("2026-11-01T00:00:00Z"), end: null }];
    expect(effectivePeriods({ periods, inFeed: true, lastSeenAt: now })).toEqual(periods);
  });

  it("フィードから消えたアラートは、最後に見た時刻で区間を終わらせ、そのあとに始まる区間は除く", () => {
    const lastSeenAt = d("2026-10-20T22:00:00Z");
    const result = effectivePeriods({
      periods: [
        { start: d("2026-10-20T20:00:00Z"), end: null },
        { start: d("2026-10-19T20:00:00Z"), end: d("2026-10-19T21:00:00Z") },
        { start: d("2026-10-25T00:00:00Z"), end: d("2026-10-26T00:00:00Z") },
      ],
      inFeed: false,
      lastSeenAt,
    });
    expect(result).toEqual([
      { start: d("2026-10-20T20:00:00Z"), end: lastSeenAt },
      { start: d("2026-10-19T20:00:00Z"), end: d("2026-10-19T21:00:00Z") },
    ]);
  });
});

describe("alertStatusOf", () => {
  it("フィードから消えたものは、区間に終わりがなくても past", () => {
    const periods = [{ start: d("2026-10-20T20:00:00Z"), end: null }];
    expect(alertStatusOf({ periods, inFeed: true, lastSeenAt: now }, now)).toBe("active");
    expect(alertStatusOf({ periods, inFeed: false, lastSeenAt: now }, now)).toBe("past");
  });
});

describe("alertOverlaps", () => {
  const alert = {
    periods: [{ start: d("2026-11-14T08:00:00Z"), end: d("2026-11-16T08:00:00Z") }],
    inFeed: true,
    lastSeenAt: now,
  };

  it("[from, to) と重なるか（境界は含まない）", () => {
    expect(alertOverlaps(alert, d("2026-11-15T00:00:00Z"), d("2026-11-15T01:00:00Z"))).toBe(true);
    expect(alertOverlaps(alert, d("2026-11-16T08:00:00Z"), d("2026-11-17T00:00:00Z"))).toBe(false);
    expect(alertOverlaps(alert, d("2026-11-13T00:00:00Z"), d("2026-11-14T08:00:00Z"))).toBe(false);
  });

  it("終わりのない区間は、それ以降のどの期間とも重なる", () => {
    const open = { ...alert, periods: [{ start: d("2026-01-01T00:00:00Z"), end: null }] };
    expect(alertOverlaps(open, d("2030-01-01T00:00:00Z"), d("2030-01-02T00:00:00Z"))).toBe(true);
  });
});
