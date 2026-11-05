// 005 T011（TR-003）: データの鮮度の表示
import { describe, expect, it } from "vitest";
import { freshnessLabel, freshnessState, staleMessage } from "@/lib/display/freshness";

const now = new Date("2026-11-05T15:20:00Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

describe("freshnessLabel", () => {
  it.each([
    [0, "just now", "now"],
    [4.9, "just now", "now"],
    [5, "5 s ago", "5 s"],
    [59, "59 s ago", "59 s"],
    [60, "1 min ago", "1 min"],
    [179, "2 min ago", "2 min"],
    [3599, "59 min ago", "59 min"],
    [3600, "1 h ago", "1 h"],
    [26 * 3600, "26 h ago", "26 h"],
  ])("%d 秒前は「%s」（短い形は「%s」）", (sec, full, compact) => {
    expect(freshnessLabel(ago(sec), now)).toBe(full);
    expect(freshnessLabel(ago(sec), now, { compact: true })).toBe(compact);
  });

  it("未来の時刻（時計のずれ）は just now", () => {
    expect(freshnessLabel(ago(-30), now)).toBe("just now");
  });

  it("まだ一度も収集していなければ「no data yet」", () => {
    expect(freshnessLabel(null, now)).toBe("no data yet");
    expect(freshnessLabel(null, now, { compact: true })).toBe("no data");
  });
});

describe("freshnessState", () => {
  it("3 分未満は live、3 分以上は stale、収集していなければ none（002 の isLiveDataStale と同じ境目）", () => {
    expect(freshnessState(ago(179), now)).toBe("live");
    expect(freshnessState(ago(180), now)).toBe("stale");
    expect(freshnessState(null, now)).toBe("none");
  });
});

describe("staleMessage", () => {
  it("どれくらい古いかと、最後の成功の時刻（ボストン時間）", () => {
    expect(staleMessage(ago(4 * 60 + 10), now)).toBe(
      "Live data is stale: the last successful collection was 4 min ago, at 10:15 AM ET.",
    );
  });

  it("まだ一度も収集していないとき", () => {
    expect(staleMessage(null, now)).toBe("Live data is stale: no collection has succeeded yet.");
  });
});
