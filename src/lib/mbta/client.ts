// MBTA V3 API のクライアント。MBTA API を呼ぶのは収集ジョブだけ（憲章の原則 I）。
// 429 を受けたらリトライせずに RateLimitedError を投げる。リトライはしない（次の回に任せる）。
import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_MBTA_API_BASE_URL } from "./constants";

export type QueryValue = string | number | readonly (string | number)[];
export type MbtaQuery = Readonly<Record<string, QueryValue>>;

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  /** 次にリセットされる時刻（x-ratelimit-reset は UNIX 秒） */
  resetAt: Date | null;
}

export interface MbtaResponse {
  body: unknown;
  rateLimit: RateLimitInfo | null;
  source: "api" | "fixture";
  /** フィクスチャモードのときに読んだファイル */
  fixtureFile?: string;
}

export class MbtaHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimit: RateLimitInfo | null,
  ) {
    super(message);
    this.name = "MbtaHttpError";
  }
}

export class RateLimitedError extends MbtaHttpError {
  constructor(rateLimit: RateLimitInfo | null) {
    super("MBTA API のレート制限に達しました（429）", 429, rateLimit);
    this.name = "RateLimitedError";
  }
}

export interface MbtaClient {
  get(path: string, query?: MbtaQuery): Promise<MbtaResponse>;
  /** これまでに呼んだリクエストの数（フィクスチャモードを含む） */
  readonly requestCount: number;
  /** 最後に受け取ったレート制限の情報 */
  readonly lastRateLimit: RateLimitInfo | null;
}

/** クライアントが使う fetch の形（標準の fetch もこの形で渡せる。テストでは差し替える） */
export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface MbtaClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetch?: FetchLike;
  fixtureMode?: boolean;
  fixturesDir?: string;
}

export const DEFAULT_FIXTURES_DIR = "tests/fixtures/mbta";

function toParam(value: QueryValue): string {
  return Array.isArray(value) ? value.join(",") : String(value);
}

export function buildUrl(baseUrl: string, apiPath: string, query: MbtaQuery = {}): URL {
  const url = new URL(apiPath, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, toParam(value));
  }
  return url;
}

function parseIntHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseRateLimit(headers: Headers): RateLimitInfo | null {
  const limit = parseIntHeader(headers, "x-ratelimit-limit");
  const remaining = parseIntHeader(headers, "x-ratelimit-remaining");
  const reset = parseIntHeader(headers, "x-ratelimit-reset");
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, resetAt: reset === null ? null : new Date(reset * 1000) };
}

/**
 * フィクスチャのファイル名の接頭辞を、リクエストから決める。
 * ファイル名は `<接頭辞>-<YYYYMMDD-HHmm>.json`（tests/fixtures/mbta/README.md）。
 */
export function fixtureKeyFor(apiPath: string, query: MbtaQuery = {}): string {
  switch (apiPath) {
    case "/vehicles":
      return "vehicles";
    case "/predictions":
      return "predictions";
    case "/alerts":
      return "alerts";
    case "/routes":
      return "routes";
    case "/route_patterns":
      return "route-patterns";
    case "/stops": {
      const include = query.include === undefined ? "" : toParam(query.include);
      if (include.split(",").includes("child_stops")) return "stops-child-stops";
      if (query["filter[id]"] !== undefined) return "stops-by-id";
      return "stops-route-type";
    }
    default:
      throw new Error(`フィクスチャがないエンドポイントです: ${apiPath}`);
  }
}

const FIXTURE_FILE_RE = /^(.+)-(\d{8}-\d{4})\.json$/;

/** 指定した接頭辞のフィクスチャのうち、最も新しいもののパスを返す */
export async function latestFixtureFile(fixturesDir: string, key: string): Promise<string> {
  const files = await readdir(fixturesDir);
  const matches = files
    .map((f) => ({ f, m: FIXTURE_FILE_RE.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null && x.m[1] === key)
    .sort((a, b) => (a.m[2] ?? "").localeCompare(b.m[2] ?? ""));
  const latest = matches.at(-1);
  if (!latest) throw new Error(`フィクスチャが見つかりません: ${fixturesDir}/${key}-*.json`);
  return path.join(fixturesDir, latest.f);
}

export function createMbtaClient(options: MbtaClientOptions = {}): MbtaClient {
  const baseUrl = options.baseUrl ?? DEFAULT_MBTA_API_BASE_URL;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  let requestCount = 0;
  let lastRateLimit: RateLimitInfo | null = null;

  async function getFromFixture(apiPath: string, query: MbtaQuery): Promise<MbtaResponse> {
    const file = await latestFixtureFile(fixturesDir, fixtureKeyFor(apiPath, query));
    const body: unknown = JSON.parse(await readFile(file, "utf8"));
    return { body, rateLimit: null, source: "fixture", fixtureFile: file };
  }

  async function getFromApi(apiPath: string, query: MbtaQuery): Promise<MbtaResponse> {
    const headers: Record<string, string> = { accept: "application/vnd.api+json" };
    if (options.apiKey) headers["x-api-key"] = options.apiKey;
    const res = await doFetch(buildUrl(baseUrl, apiPath, query), { headers });
    const rateLimit = parseRateLimit(res.headers);
    lastRateLimit = rateLimit ?? lastRateLimit;
    if (res.status === 429) throw new RateLimitedError(rateLimit);
    if (!res.ok) {
      throw new MbtaHttpError(
        `MBTA API がエラーを返しました: ${res.status} ${apiPath}`,
        res.status,
        rateLimit,
      );
    }
    const body: unknown = await res.json();
    return { body, rateLimit, source: "api" };
  }

  return {
    async get(apiPath, query = {}) {
      requestCount += 1;
      return options.fixtureMode ? getFromFixture(apiPath, query) : getFromApi(apiPath, query);
    },
    get requestCount() {
      return requestCount;
    },
    get lastRateLimit() {
      return lastRateLimit;
    },
  };
}

/** 環境変数（MBTA_API_BASE_URL / MBTA_API_KEY / MBTA_FIXTURE_MODE）からクライアントを作る */
export function mbtaClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<MbtaClientOptions> = {},
): MbtaClient {
  return createMbtaClient({
    baseUrl: env.MBTA_API_BASE_URL || DEFAULT_MBTA_API_BASE_URL,
    apiKey: env.MBTA_API_KEY || undefined,
    fixtureMode: env.MBTA_FIXTURE_MODE === "1",
    ...overrides,
  });
}
