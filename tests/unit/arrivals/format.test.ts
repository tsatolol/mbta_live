// 駅の到着表示の文言
import { describe, expect, it } from "vitest";
import { countdownClock, countdownLabel, matchesStationQuery } from "@/components/arrivals/format";
import { effectLabel } from "@/components/arrivals/station-alerts";

const now = new Date("2026-11-02T15:20:00Z");
const at = (sec: number) => new Date(now.getTime() + sec * 1000);

describe("countdownLabel", () => {
  it("1 分以上は n min（切り捨て）、1 分未満は < 1 min、過ぎたら null", () => {
    expect(countdownLabel(at(5 * 60 + 59), now)).toBe("5 min");
    expect(countdownLabel(at(60), now)).toBe("1 min");
    expect(countdownLabel(at(59), now)).toBe("< 1 min");
    expect(countdownLabel(at(0), now)).toBeNull();
    expect(countdownLabel(at(-30), now)).toBeNull();
  });
});

describe("countdownClock", () => {
  it("m:ss で毎秒進む", () => {
    expect(countdownClock(at(125), now)).toBe("2:05");
    expect(countdownClock(at(124.5), now)).toBe("2:04");
    expect(countdownClock(at(0), now)).toBe("0:00");
    expect(countdownClock(at(-1), now)).toBeNull();
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

describe("effectLabel", () => {
  it("effect を読みやすくする", () => {
    expect(effectLabel("STATION_ISSUE")).toBe("Station Issue");
    expect(effectLabel("DELAY")).toBe("Delay");
  });
});
