// 002 TR-001: GET /api/status（稼働状況）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getStatus, RECENT_RUNS } from "@/lib/api/status";
import { statusResponseSchema } from "@/lib/api-schemas/status";
import { createTestDb, resetData } from "../../helpers/db";
import { LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
const now = new Date(LIVE_RECORDED_AT.getTime() + 60_000);
const handler = getStatus({ db, clock: fixedClock(now) });

async function status() {
  const res = await handler();
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return statusResponseSchema.parse(await res.json());
}

const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
  // collector の失敗（30 分前、レート制限の残量 0）と、古い失敗（2 日前。24 時間の数には入らない）
  await db.collectorRun.createMany({
    data: [
      {
        job: "collect",
        startedAt: minutesAgo(30),
        finishedAt: minutesAgo(30),
        status: "failed",
        error: "RateLimitedError: 429",
        ratelimitRemaining: 0,
      },
      {
        job: "collect",
        startedAt: minutesAgo(2 * 24 * 60),
        finishedAt: minutesAgo(2 * 24 * 60),
        status: "failed",
        error: "Error: old",
      },
      // 12 回の skipped（直近の実行は新しい順に 10 件まで）
      ...Array.from({ length: 12 }, (_, i) => ({
        job: "aggregate",
        startedAt: minutesAgo(100 + i),
        finishedAt: minutesAgo(100 + i),
        status: "skipped",
      })),
    ],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/status", () => {
  it("ジョブごとの直近の実行（状態・件数・エラー）と、24 時間の実行と失敗の数を返す", async () => {
    const res = await status();
    expect(res.jobs.map((j) => j.job)).toEqual(["collect", "sync-static", "aggregate"]);

    const collect = res.jobs.find((j) => j.job === "collect")!;
    // 直近は seedLive の collector の成功（記録の時刻）
    expect(collect.lastRun).toMatchObject({ status: "success", error: null });
    expect(collect.lastRun?.counts).toMatchObject({ vehicles: 106, predictions: 2278, alerts: 12 });
    expect(collect.lastSuccessAt).toBe(res.lastCollectedAt);
    expect(collect.recentRuns.map((r) => r.status)).toEqual(["success", "failed", "failed"]);
    expect(collect.recentRuns[1]?.error).toBe("RateLimitedError: 429");
    expect(collect).toMatchObject({ runsLast24h: 2, failedLast24h: 1 });

    const aggregate = res.jobs.find((j) => j.job === "aggregate")!;
    expect(aggregate.recentRuns).toHaveLength(RECENT_RUNS);
    const starts = aggregate.recentRuns.map((r) => Date.parse(r.startedAt));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
    expect(aggregate).toMatchObject({ lastSuccessAt: null, runsLast24h: 12, failedLast24h: 0 });

    // sync-static は seedLive ではジョブとして動かしていない
    const sync = res.jobs.find((j) => j.job === "sync-static")!;
    expect(sync).toMatchObject({ lastRun: null, recentRuns: [], lastSuccessAt: null });
  });

  it("レート制限の残量は、最後に記録した collector の実行の値", async () => {
    const res = await status();
    // seedLive の成功（記録の時刻）が 30 分前の失敗（残量 0）より新しい
    expect(res.rateLimitRemaining).toBe(17);
  });

  it("テーブルごとの行数（ANALYZE 前のパーティションは数える）", async () => {
    const res = await status();
    const rows = Object.fromEntries(res.tables.map((t) => [t.name, t]));
    expect(rows.vehicles_current).toEqual({
      name: "vehicles_current",
      rows: 106,
      estimated: false,
    });
    expect(rows.predictions_current?.rows).toBe(2278);
    expect(rows.alerts?.rows).toBe(12);
    expect(rows.collector_runs?.rows).toBe(15);
    expect(rows.routes?.rows).toBe(8);
    expect(rows.vehicle_positions?.rows).toBe(106);
    expect(rows.arrival_events?.rows).toBe(46);
    expect(rows.prediction_samples?.rows).toBe(630);
  });

  it("ANALYZE したパーティションは推定値（reltuples）を使い、推定値であることを示す", async () => {
    await db.$executeRawUnsafe('ANALYZE "vehicle_positions"');
    const res = await status();
    const positions = res.tables.find((t) => t.name === "vehicle_positions");
    expect(positions).toEqual({ name: "vehicle_positions", rows: 106, estimated: true });
  });
});
