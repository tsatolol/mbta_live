// 実 API からフィクスチャを 1 回分記録する（pnpm fixtures:record）。
// specs/001-data-collection/contracts/mbta-api.md のパラメータで 7 リクエストを送り、
// tests/fixtures/mbta/<endpoint>-<YYYYMMDD-HHmm>.json に応答をそのまま保存する（時刻はボストン時間）。
// キーなしの上限は 20 req/分（送信元 IP 単位）なので、リクエストの間隔を空ける。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { DEFAULT_FIXTURES_DIR, mbtaClientFromEnv, type MbtaQuery } from "../src/lib/mbta/client";
import { TARGET_ROUTE_IDS, TARGET_ROUTE_TYPES } from "../src/lib/mbta/constants";
import { formatInBoston } from "../src/lib/time";

const INTERVAL_MS = 3_000;

const routes = TARGET_ROUTE_IDS.join(",");
const stamp = formatInBoston(new Date(), "yyyyMMdd-HHmm");
const outDir = process.env.MBTA_FIXTURES_DIR || DEFAULT_FIXTURES_DIR;
const client = mbtaClientFromEnv(process.env, { fixtureMode: false });

async function record(key: string, apiPath: string, query: MbtaQuery): Promise<unknown> {
  const res = await client.get(apiPath, query);
  const file = path.join(outDir, `${key}-${stamp}.json`);
  await writeFile(file, JSON.stringify(res.body));
  console.log(`${file}  remaining=${res.rateLimit?.remaining ?? "?"}`);
  await sleep(INTERVAL_MS);
  return res.body;
}

const stopsDocSchema = z.object({ included: z.array(z.object({ id: z.string() })).default([]) });

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await record("vehicles", "/vehicles", { "filter[route]": routes });
  await record("predictions", "/predictions", { "filter[route]": routes });
  await record("alerts", "/alerts", { "filter[route]": routes });
  await record("routes", "/routes", { "filter[type]": TARGET_ROUTE_TYPES.join(",") });
  const stops = await record("stops-route-type", "/stops", {
    "filter[route_type]": TARGET_ROUTE_TYPES.join(","),
    include: "parent_station",
  });
  const parentIds = stopsDocSchema.parse(stops).included.map((s) => s.id);
  await record("stops-child-stops", "/stops", { "filter[id]": parentIds, include: "child_stops" });
  await record("route-patterns", "/route_patterns", {
    "filter[route]": routes,
    include: "representative_trip.shape,representative_trip.stops",
    "fields[stop]": "name,parent_station",
  });
  console.log(`requests=${client.requestCount}`);
}

await main();
