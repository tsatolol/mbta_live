// TR-008 の一部: MBTA クライアント（実 API は呼ばない。fetch を差し替える）
import { describe, expect, it, vi } from "vitest";
import {
  RateLimitedError,
  MbtaHttpError,
  buildUrl,
  createMbtaClient,
  fixtureKeyFor,
  mbtaClientFromEnv,
} from "@/lib/mbta/client";

type FetchArgs = [input: URL, init: RequestInit];

/** fetch の代わり。呼ばれた引数を記録する */
function mockFetch(respond: () => Response) {
  return vi.fn(async (..._args: FetchArgs) => respond());
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/vnd.api+json", ...headers },
  });
}

const RATE_HEADERS = {
  "x-ratelimit-limit": "20",
  "x-ratelimit-remaining": "17",
  "x-ratelimit-reset": "1793524920",
};

describe("createMbtaClient", () => {
  it("API キーがあれば x-api-key ヘッダーを送る", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }));
    const client = createMbtaClient({ apiKey: "secret-key", fetch: fetchMock });
    await client.get("/vehicles");
    const headers = fetchMock.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret-key");
  });

  it("API キーがなければ x-api-key ヘッダーを送らない", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }));
    const client = createMbtaClient({ fetch: fetchMock });
    await client.get("/vehicles");
    const headers = fetchMock.mock.calls[0]?.[1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty("x-api-key");
  });

  it("filter と fields を URL に組み立てる（配列はカンマ区切り）", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }));
    const client = createMbtaClient({ fetch: fetchMock, baseUrl: "https://example.test" });
    await client.get("/vehicles", {
      "filter[route]": ["Red", "Orange"],
      "fields[vehicle]": "latitude",
    });
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url?.origin).toBe("https://example.test");
    expect(url?.pathname).toBe("/vehicles");
    expect(url?.searchParams.get("filter[route]")).toBe("Red,Orange");
    expect(url?.searchParams.get("fields[vehicle]")).toBe("latitude");
  });

  it("レート制限ヘッダーを読む（reset は UNIX 秒）", async () => {
    const client = createMbtaClient({
      fetch: async () => jsonResponse({ data: [] }, 200, RATE_HEADERS),
    });
    const res = await client.get("/alerts");
    expect(res.rateLimit).toEqual({
      limit: 20,
      remaining: 17,
      resetAt: new Date(1793524920 * 1000),
    });
    expect(client.lastRateLimit?.remaining).toBe(17);
  });

  it("429 で RateLimitedError を投げ、リトライしない", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ errors: [] }, 429, { ...RATE_HEADERS, "x-ratelimit-remaining": "0" }),
    );
    const client = createMbtaClient({ fetch: fetchMock });
    const error = await client.get("/vehicles").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitedError);
    expect((error as RateLimitedError).rateLimit?.remaining).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 以外のエラーは MbtaHttpError", async () => {
    const client = createMbtaClient({ fetch: async () => jsonResponse({ errors: [] }, 503) });
    const error = await client.get("/vehicles").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MbtaHttpError);
    expect(error).not.toBeInstanceOf(RateLimitedError);
    expect((error as MbtaHttpError).status).toBe(503);
  });

  it("リクエスト数を数える", async () => {
    const client = createMbtaClient({ fetch: async () => jsonResponse({ data: [] }) });
    await client.get("/vehicles");
    await client.get("/predictions", { "filter[route]": "Red" });
    await client.get("/alerts");
    expect(client.requestCount).toBe(3);
  });

  it("フィクスチャモードではファイルを読み、fetch を呼ばない", async () => {
    const fetchMock = vi.fn();
    const client = createMbtaClient({ fixtureMode: true, fetch: fetchMock });
    const res = await client.get("/vehicles", { "filter[route]": "Red" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.source).toBe("fixture");
    // 最も新しいフィクスチャを読む
    expect(res.fixtureFile).toMatch(/vehicles-\d{8}-\d{4}\.json$/);
    expect(res.body).toHaveProperty("data");
    expect(client.requestCount).toBe(1);
  });
});

describe("fixtureKeyFor", () => {
  it.each([
    ["/vehicles", {}, "vehicles"],
    ["/route_patterns", {}, "route-patterns"],
    ["/stops", { "filter[route_type]": "0,1", include: "parent_station" }, "stops-route-type"],
    ["/stops", { "filter[id]": "place-a", include: "child_stops" }, "stops-child-stops"],
    ["/stops", { "filter[id]": "Alewife-01" }, "stops-by-id"],
  ] as const)("%s %o → %s", (p, q, expected) => {
    expect(fixtureKeyFor(p, q)).toBe(expected);
  });
});

describe("mbtaClientFromEnv", () => {
  it("MBTA_FIXTURE_MODE=1 でフィクスチャモードになる", async () => {
    const fetchMock = vi.fn();
    const client = mbtaClientFromEnv(
      { ...process.env, MBTA_FIXTURE_MODE: "1" },
      { fetch: fetchMock },
    );
    await client.get("/routes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("buildUrl は MBTA_API_BASE_URL を使う", () => {
    expect(buildUrl("https://api-v3.mbta.com", "/alerts").toString()).toBe(
      "https://api-v3.mbta.com/alerts",
    );
  });
});
