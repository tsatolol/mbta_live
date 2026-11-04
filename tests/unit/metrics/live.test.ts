// 002 TR-002: リアルタイム画面で計算する値（時計を固定する）
import { describe, expect, it } from "vitest";
import { alertStatus, isLiveDataStale, isStale, minutesUntil } from "@/lib/metrics/live";

const now = new Date("2026-11-02T15:20:00Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);
const later = (sec: number) => new Date(now.getTime() + sec * 1000);

describe("isStale", () => {
  it("2 分 59 秒前はまだ新しく、3 分ちょうどで古い", () => {
    expect(isStale(ago(179), now)).toBe(false);
    expect(isStale(ago(180), now)).toBe(true);
  });

  it("未来の時刻（時計のずれ）は新しいとみなす", () => {
    expect(isStale(later(5), now)).toBe(false);
  });
});

describe("alertStatus", () => {
  it("区間に入っていれば active（start は含み、end は含まない）", () => {
    expect(alertStatus([{ start: now, end: later(60) }], now)).toBe("active");
    expect(alertStatus([{ start: ago(60), end: now }], now)).toBe("past");
  });

  it("終わりのない区間は、始まっていれば active", () => {
    expect(alertStatus([{ start: ago(3600), end: null }], now)).toBe("active");
  });

  it("すべての区間が未来なら upcoming", () => {
    expect(
      alertStatus(
        [
          { start: later(60), end: later(120) },
          { start: later(3600), end: null },
        ],
        now,
      ),
    ).toBe("upcoming");
  });

  it("複数の区間のどれかに入っていれば active", () => {
    expect(
      alertStatus(
        [
          { start: ago(7200), end: ago(3600) },
          { start: ago(60), end: later(60) },
        ],
        now,
      ),
    ).toBe("active");
  });

  it("過去の区間と未来の区間があり、今どれにも入っていなければ past", () => {
    expect(
      alertStatus(
        [
          { start: ago(7200), end: ago(3600) },
          { start: later(3600), end: later(7200) },
        ],
        now,
      ),
    ).toBe("past");
  });

  it("区間がなければ past", () => {
    expect(alertStatus([], now)).toBe("past");
  });
});

describe("minutesUntil", () => {
  it("分に切り捨てる", () => {
    expect(minutesUntil(later(59), now)).toBe(0);
    expect(minutesUntil(later(60), now)).toBe(1);
    expect(minutesUntil(later(179), now)).toBe(2);
  });

  it("過ぎた時刻は負の値", () => {
    expect(minutesUntil(ago(1), now)).toBe(-1);
  });
});

describe("isLiveDataStale", () => {
  it("一度も収集に成功していなければ stale", () => {
    expect(isLiveDataStale(null, now)).toBe(true);
  });

  it("3 分ちょうどで stale", () => {
    expect(isLiveDataStale(ago(179), now)).toBe(false);
    expect(isLiveDataStale(ago(180), now)).toBe(true);
  });
});
