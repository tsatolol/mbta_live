// TR-004: 運行日と時刻
import { describe, expect, it } from "vitest";
import {
  addServiceDays,
  formatInBoston,
  isServiceDate,
  parseMbtaDateTime,
  serviceDateOf,
  serviceDateToDbDate,
  serviceDayRange,
} from "@/lib/time";

const hours = (r: { start: Date; end: Date }) => (r.end.getTime() - r.start.getTime()) / 3_600_000;

describe("serviceDateOf", () => {
  it.each([
    // [UTC の時刻, 期待する運行日, 説明]
    ["2026-11-02T15:00:00Z", "2026-11-02", "平日の日中（EST 10:00）"],
    ["2026-11-03T04:30:00Z", "2026-11-02", "深夜 23:30 ET は同じ日"],
    ["2026-11-03T05:30:00Z", "2026-11-02", "深夜 00:30 ET は前日の運行日"],
    ["2026-11-03T07:59:59Z", "2026-11-02", "02:59:59 ET は前日の運行日"],
    ["2026-11-03T08:00:00Z", "2026-11-03", "03:00 ET から新しい運行日"],
    ["2026-07-01T06:59:59Z", "2026-06-30", "夏時間（EDT）の 02:59:59"],
    ["2026-07-01T07:00:00Z", "2026-07-01", "夏時間（EDT）の 03:00"],
    ["2027-01-01T04:00:00Z", "2026-12-31", "年をまたぐ深夜 23:00 ET"],
    ["2027-01-01T06:00:00Z", "2026-12-31", "年をまたぐ深夜 01:00 ET"],
  ])("%s は %s（%s）", (utc, expected) => {
    expect(serviceDateOf(new Date(utc))).toBe(expected);
  });

  it("夏時間の終了日（2026-11-01）に 2 回ある 01:30 は、どちらも前日の運行日", () => {
    expect(serviceDateOf(new Date("2026-11-01T05:30:00Z"))).toBe("2026-10-31"); // 01:30 EDT
    expect(serviceDateOf(new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-31"); // 01:30 EST
    expect(serviceDateOf(new Date("2026-11-01T08:00:00Z"))).toBe("2026-11-01"); // 03:00 EST
  });

  it("夏時間の開始日（2027-03-14）の 03:00 EDT から新しい運行日", () => {
    expect(serviceDateOf(new Date("2027-03-14T06:59:59Z"))).toBe("2027-03-13"); // 01:59:59 EST
    expect(serviceDateOf(new Date("2027-03-14T07:00:00Z"))).toBe("2027-03-14"); // 03:00 EDT
  });
});

describe("serviceDayRange", () => {
  it("通常の運行日は ET の 03:00 から翌日の 03:00 までの 24 時間", () => {
    const r = serviceDayRange("2026-11-02");
    expect(r.start.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(hours(r)).toBe(24);
  });

  it("夏時間の終了を含む運行日（2026-10-31）は 25 時間", () => {
    const r = serviceDayRange("2026-10-31");
    expect(r.start.toISOString()).toBe("2026-10-31T07:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(hours(r)).toBe(25);
  });

  it("夏時間の開始を含む運行日（2027-03-13）は 23 時間", () => {
    const r = serviceDayRange("2027-03-13");
    expect(r.start.toISOString()).toBe("2027-03-13T08:00:00.000Z");
    expect(r.end.toISOString()).toBe("2027-03-14T07:00:00.000Z");
    expect(hours(r)).toBe(23);
  });

  it("範囲の端は serviceDateOf と一致する（start は含み、end は含まない）", () => {
    for (const d of ["2026-10-31", "2026-11-01", "2027-03-13", "2027-03-14"]) {
      const r = serviceDayRange(d);
      expect(serviceDateOf(r.start)).toBe(d);
      expect(serviceDateOf(new Date(r.end.getTime() - 1))).toBe(d);
      expect(serviceDateOf(r.end)).toBe(addServiceDays(d, 1));
    }
  });

  it("形式の正しくない運行日は例外", () => {
    expect(() => serviceDayRange("2026-02-30")).toThrow();
    expect(() => serviceDayRange("20261102")).toThrow();
  });
});

describe("parseMbtaDateTime", () => {
  it("-05:00（EST）と -04:00（EDT）のオフセットを正しく扱う", () => {
    expect(parseMbtaDateTime("2026-11-01T05:23:46-05:00").toISOString()).toBe(
      "2026-11-01T10:23:46.000Z",
    );
    expect(parseMbtaDateTime("2026-10-07T15:03:54-04:00").toISOString()).toBe(
      "2026-10-07T19:03:54.000Z",
    );
  });

  it("オフセットのない文字列は受け付けない（ローカル時刻として誤って解釈しないため）", () => {
    expect(() => parseMbtaDateTime("2026-11-01T05:23:46")).toThrow();
    expect(() => parseMbtaDateTime("not a date")).toThrow();
  });
});

describe("その他", () => {
  it("addServiceDays は月と年をまたぐ", () => {
    expect(addServiceDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addServiceDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("isServiceDate", () => {
    expect(isServiceDate("2026-11-02")).toBe(true);
    expect(isServiceDate("2026-13-01")).toBe(false);
  });

  it("serviceDateToDbDate は UTC の 0 時", () => {
    expect(serviceDateToDbDate("2026-11-02").toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("formatInBoston はボストン時間で書式化する", () => {
    expect(formatInBoston(new Date("2026-11-02T15:04:05Z"), "HH:mm:ss")).toBe("10:04:05");
  });
});
