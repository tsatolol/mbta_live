// 003 T044: 今日の分の計算の使い回し
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedToday, clearTodayCache, TODAY_CACHE_TTL_MS } from "@/lib/api/today-cache";

beforeEach(() => {
  clearTodayCache();
});

describe("cachedToday", () => {
  it("同じ key は ttl の間だけ使い回し、過ぎたら計算し直す", async () => {
    const compute = vi.fn(async () => 1);
    expect(await cachedToday("headways|2026-11-10", 0, compute)).toBe(1);
    expect(await cachedToday("headways|2026-11-10", TODAY_CACHE_TTL_MS - 1, compute)).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
    await cachedToday("headways|2026-11-10", TODAY_CACHE_TTL_MS, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("key（指標・運行日）が違えば別に計算する", async () => {
    const compute = vi.fn(async () => 1);
    await cachedToday("headways|2026-11-10", 0, compute);
    await cachedToday("headways|2026-11-11", 0, compute);
    await cachedToday("alerts|2026-11-10", 0, compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("同時に来たリクエストは、同じ計算を待つ", async () => {
    let resolve!: (v: number) => void;
    const compute = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const a = cachedToday("k", 0, compute);
    const b = cachedToday("k", 10, compute);
    resolve(5);
    expect(await Promise.all([a, b])).toEqual([5, 5]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("失敗した計算は残さない", async () => {
    await expect(
      cachedToday("k", 0, async () => Promise.reject(new Error("db"))),
    ).rejects.toThrow();
    await Promise.resolve();
    expect(await cachedToday("k", 1, async () => 2)).toBe(2);
  });
});
