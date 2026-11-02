// 実 API から連続ポーリングを記録する（pnpm fixtures:record-sequence --count 30）。再生テスト用。
// collector と同じ 3 リクエストを 60 秒ごとに送り（3 req/分）、応答をそのまま保存する:
//   tests/fixtures/mbta/sequences/<YYYYMMDD-HHmm>/<NNN>-<endpoint>.json.gz（容量を抑えるため gzip で圧縮）
//   tests/fixtures/mbta/sequences/<YYYYMMDD-HHmm>/index.json  … 各回の記録時刻（polledAt、UTC）
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { DEFAULT_FIXTURES_DIR, mbtaClientFromEnv } from "../src/lib/mbta/client";
import { REALTIME_REQUESTS } from "../src/lib/mbta/realtime";
import { formatInBoston } from "../src/lib/time";

const INTERVAL_MS = 60_000;

const { values } = parseArgs({ options: { count: { type: "string", default: "30" } } });
const count = Number(values.count);
if (!Number.isInteger(count) || count < 2)
  throw new Error("--count は 2 以上の整数で指定してください");

const startedAt = new Date();
const dir = path.join(
  process.env.MBTA_FIXTURES_DIR || DEFAULT_FIXTURES_DIR,
  "sequences",
  formatInBoston(startedAt, "yyyyMMdd-HHmm"),
);
const client = mbtaClientFromEnv(process.env, { fixtureMode: false });
const index: { step: number; polledAt: string }[] = [];

await mkdir(dir, { recursive: true });
for (let step = 0; step < count; step++) {
  const stepStart = Date.now();
  const polledAt = new Date();
  for (const [key, req] of Object.entries(REALTIME_REQUESTS)) {
    const res = await client.get(req.path, req.query);
    const file = path.join(dir, `${String(step).padStart(3, "0")}-${key}.json.gz`);
    await writeFile(file, gzipSync(JSON.stringify(res.body), { level: 9 }));
  }
  index.push({ step, polledAt: polledAt.toISOString() });
  await writeFile(path.join(dir, "index.json"), `${JSON.stringify({ polls: index }, null, 2)}\n`);
  console.log(`${dir} step=${step} remaining=${client.lastRateLimit?.remaining ?? "?"}`);
  if (step < count - 1) await sleep(Math.max(0, INTERVAL_MS - (Date.now() - stepStart)));
}
