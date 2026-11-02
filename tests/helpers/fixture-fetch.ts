// テスト用の fetch: リクエストからフィクスチャの接頭辞を決め、最も新しいファイルを返す。接頭辞ごとに本文を差し替えられる
import { readFile } from "node:fs/promises";
import { vi } from "vitest";
import {
  fixtureKeyFor,
  latestFixtureFile,
  type FetchLike,
  type MbtaQuery,
} from "@/lib/mbta/client";
import { FIXTURES_DIR } from "./fixtures";

export function fixtureFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn<FetchLike>(async (input) => {
    const query: MbtaQuery = Object.fromEntries(input.searchParams.entries());
    const key = fixtureKeyFor(input.pathname, query);
    const body =
      key in overrides
        ? overrides[key]
        : JSON.parse(await readFile(await latestFixtureFile(FIXTURES_DIR, key), "utf8"));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/vnd.api+json", "x-ratelimit-remaining": "15" },
    });
  });
}
