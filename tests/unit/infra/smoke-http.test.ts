import { describe, expect, it, vi } from "vitest";
import { smokeGet } from "../../helpers/smoke-http";

function dependencies() {
  return { fetch: vi.fn<typeof fetch>(), wait: vi.fn(async () => {}), report: vi.fn() };
}

describe("スモークテストの一時的な通信エラー", () => {
  it.each([500, 502, 503, 504])("%s の後は待って再試行する", async (status) => {
    const deps = dependencies();
    deps.fetch
      .mockResolvedValueOnce(new Response("temporary", { status }))
      .mockResolvedValueOnce(new Response("ok"));
    expect(
      (
        await smokeGet(
          "https://example.test/api/health?secret=hidden",
          { headers: { authorization: "Bearer secret" } },
          deps,
        )
      ).status,
    ).toBe(200);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledExactlyOnceWith(5000);
    expect(deps.fetch.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { authorization: "Bearer secret" },
      signal: expect.any(AbortSignal),
    });
    expect(deps.report.mock.calls.join()).not.toContain("secret");
  });
  it("継続する 503 は 3 回で打ち切り、失敗応答を返す", async () => {
    const deps = dependencies();
    deps.fetch.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    expect((await smokeGet("https://example.test/api/health", {}, deps)).status).toBe(503);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.wait).toHaveBeenCalledTimes(2);
  });
  it.each([200, 302, 400, 401, 403, 429, 501])(
    "%s はそのまま返し、再試行しない",
    async (status) => {
      const deps = dependencies();
      deps.fetch.mockResolvedValue(new Response("not valid JSON", { status }));
      const res = await smokeGet("https://example.test/api/health", {}, deps);
      expect(res.status).toBe(status);
      expect(deps.fetch).toHaveBeenCalledTimes(1);
      expect(deps.wait).not.toHaveBeenCalled();
    },
  );
  it("接続エラーとタイムアウトも最大 3 回までで例外を返す", async () => {
    const deps = dependencies();
    const timeout = new DOMException("timeout", "TimeoutError");
    deps.fetch.mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValue(timeout);
    await expect(smokeGet("https://example.test/api/health", {}, deps)).rejects.toBe(timeout);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.wait).toHaveBeenCalledTimes(2);
  });
  it("通信以外の例外を再試行しない", async () => {
    const deps = dependencies();
    const error = new Error("programming error");
    deps.fetch.mockRejectedValue(error);
    await expect(smokeGet("https://example.test/api/health", {}, deps)).rejects.toBe(error);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });
  it("各リクエストを 5 秒でタイムアウトさせる", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies();
      const signals: AbortSignal[] = [];
      deps.fetch.mockImplementation(async (_url, init) => {
        signals.push(init!.signal!);
        return new Response("ok");
      });
      await smokeGet("https://example.test/api/health", {}, deps);
      expect(signals[0]?.aborted).toBe(false);
      // AbortSignal.timeout は Node 内部の時計を使うため、作成時の値を別に検証する。
      const spy = vi.spyOn(AbortSignal, "timeout");
      await smokeGet("https://example.test/api/health", {}, deps);
      expect(spy).toHaveBeenCalledWith(5000);
      spy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
