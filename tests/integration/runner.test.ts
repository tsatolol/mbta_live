// ジョブの共通部分（T024）: 実行記録と advisory lock
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { RateLimitedError } from "@/lib/mbta/client";
import { JOB_LOCK_KEYS, runJob, withAdvisoryLock } from "@/jobs/runner";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";

const db = createTestDb();
const clock = fixedClock("2026-11-02T15:00:00Z");
const deps = { db, clock, connectionString: testDatabaseUrl() };

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("runJob", () => {
  it("成功を記録する", async () => {
    const result = await runJob("collect", deps, async () => ({
      counts: { vehicles: 23 },
      ratelimitRemaining: 19,
    }));
    expect(result).toMatchObject({ status: "success", exitCode: 0 });
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({
      job: "collect",
      status: "success",
      counts: { vehicles: 23 },
      ratelimitRemaining: 19,
    });
    expect(run.finishedAt).not.toBeNull();
  });

  it("例外は failed（終了コード 1）として記録する", async () => {
    const result = await runJob("collect", deps, async () => {
      throw new Error("boom");
    });
    expect(result).toMatchObject({ status: "failed", exitCode: 1 });
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.error).toBe("Error: boom");
  });

  it("429 のときはレート制限の残量も記録する", async () => {
    const result = await runJob("collect", deps, async () => {
      throw new RateLimitedError({ limit: 20, remaining: 0, resetAt: null });
    });
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ status: "failed", ratelimitRemaining: 0 });
  });

  it("同じジョブが動いている間は skipped ですぐ終わる", async () => {
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const startedSignal = new Promise<void>((resolve) => (started = resolve));
    const first = runJob("collect", deps, async () => {
      started();
      await blocker;
      return {};
    });
    await startedSignal;
    const second = await runJob("collect", deps, async () => ({}));
    expect(second).toMatchObject({ status: "skipped", exitCode: 0 });
    release();
    expect(await first).toMatchObject({ status: "success" });
  });

  it("別のジョブは同時に動ける", async () => {
    const result = await withAdvisoryLock(testDatabaseUrl(), JOB_LOCK_KEYS.collect, () =>
      runJob("sync-static", deps, async () => ({})),
    );
    expect(result).toMatchObject({ acquired: true, value: { status: "success" } });
  });
});
