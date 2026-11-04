// 地図のポップアップの文言
import { describe, expect, it } from "vitest";
import { ageLabel, statusLabel } from "@/components/map/vehicle-format";

describe("statusLabel", () => {
  it("MBTA の current_status を表示用にする", () => {
    expect(statusLabel("STOPPED_AT")).toBe("Stopped at");
    expect(statusLabel("IN_TRANSIT_TO")).toBe("In transit to");
    expect(statusLabel("INCOMING_AT")).toBe("Approaching");
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-11-02T15:20:00Z");
  it("1 分未満は秒、それ以上は分と秒", () => {
    expect(ageLabel(new Date(now.getTime() - 35_000), now)).toBe("35s ago");
    expect(ageLabel(new Date(now.getTime() - 250_000), now)).toBe("4m 10s ago");
  });
  it("未来の時刻（時計のずれ）は 0 秒", () => {
    expect(ageLabel(new Date(now.getTime() + 5_000), now)).toBe("0s ago");
  });
});
