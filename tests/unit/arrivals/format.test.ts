// 005 US3: カウントダウンの境界と、取得時点の過去便の除外。
import { describe, expect, it } from "vitest";
import {
  countdownLabel,
  arrivalDirectionLabel,
  upcomingArrivals,
  matchesStationQuery,
} from "@/components/arrivals/format";

const now = new Date("2026-11-02T15:20:00Z");
const at = (sec: number) => new Date(now.getTime() + sec * 1000);

describe("countdownLabel", () => {
  it.each([
    [359, "5 min"],
    [180, "3 min"],
    [120, "2 min"],
    [119.999, "1:59"],
    [83, "1:23"],
    [60, "1:00"],
    [59, "0:59"],
    [1, "0:01"],
    [0.5, "0:00"],
    [0, "Now"],
    [-30, "Now"],
  ])("残り %s 秒を %s と表示する", (sec, expected) => {
    expect(countdownLabel(at(sec), now)).toBe(expected);
  });
});

describe("upcomingArrivals", () => {
  it("取得時点で過ぎていた便を除き、取得後に時刻を迎えた便は次の取得まで Now にする", () => {
    const arrivals = [-1, 0, 1, 180].map((sec) => ({
      time: at(sec).toISOString(),
      tripId: String(sec),
    }));
    const visible = upcomingArrivals(arrivals, now);
    expect(visible.map((a) => a.tripId)).toEqual(["1", "180"]);
    expect(countdownLabel(new Date(visible[0]!.time), at(5))).toBe("Now");
    expect(upcomingArrivals(arrivals, at(5)).map((a) => a.tripId)).toEqual(["180"]);
    expect(arrivals).toHaveLength(4);
  });
});

describe("matchesStationQuery", () => {
  it("大文字・小文字と前後の空白を無視した部分一致", () => {
    expect(matchesStationQuery("Park Street", "  park ")).toBe(true);
    expect(matchesStationQuery("Park Street", "STREET")).toBe(true);
    expect(matchesStationQuery("Park Street", "harvard")).toBe(false);
    expect(matchesStationQuery("Park Street", "")).toBe(true);
  });
});

// MBTA は South / North と Inbound / Outbound の両方を返す。
describe("arrivalDirectionLabel", () => {
  it.each([
    ["South", "southbound"],
    ["North", "northbound"],
    ["Outbound", "outbound"],
    ["Inbound", "inbound"],
  ])("%s を %s と表示する", (name, label) => {
    expect(arrivalDirectionLabel(name)).toBe(label);
  });
});
