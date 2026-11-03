// 004 T039: ジョブの終了ログに、監視（ログベースの指標）が読む項目が必ず入る
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock } from "@/lib/clock";
import { createMbtaClient } from "@/lib/mbta/client";
import { runJob } from "@/jobs/runner";
import { runCollect } from "@/jobs/collect";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { fakeMbtaFetch } from "../helpers/fake-mbta";
import { readFixture, WEEKDAY } from "../helpers/fixtures";
import { seedStaticFromFixtures } from "../helpers/seed";

const db = createTestDb();
let lines: string[] = [];

/** 標準出力に書かれた 1 行 1 JSON のログのうち、ジョブの終了ログを返す */
function endLogs(): Record<string, unknown>[] {
  return lines
    .flatMap((line) => line.split("\n"))
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (entry) => typeof entry.message === "string" && entry.message.endsWith("が終了しました"),
    );
}

beforeEach(async () => {
  await resetData(db);
  lines = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ジョブの終了ログ", () => {
  it("job・status・counts が入り、logFields が足される", async () => {
    await runJob(
      "sync-static",
      { db, clock: fixedClock("2026-11-03T09:00:00Z"), connectionString: testDatabaseUrl() },
      async () => ({ counts: { routes: 8 }, logFields: { note: "x" } }),
    );
    const [log] = endLogs();
    expect(log).toMatchObject({
      severity: "INFO",
      job: "sync-static",
      status: "success",
      counts: { routes: 8 },
      note: "x",
    });
  });

  it("失敗したときも job と status（failed）が入る", async () => {
    await runJob(
      "aggregate",
      { db, clock: fixedClock("2026-11-03T09:30:00Z"), connectionString: testDatabaseUrl() },
      async () => {
        throw new Error("boom");
      },
    );
    expect(endLogs()[0]).toMatchObject({ job: "aggregate", status: "failed", counts: {} });
  });

  it("collector は車両数・解析に失敗した行・未解決の駅 ID の数と、運行時間中か・解析失敗の割合を出す", async () => {
    await seedStaticFromFixtures(db);
    const fetch = fakeMbtaFetch({
      bodies: {
        vehicles: await readFixture(WEEKDAY.vehicles),
        predictions: await readFixture(WEEKDAY.predictions),
        alerts: await readFixture(WEEKDAY.alerts),
      },
    });
    await runCollect({
      db,
      client: createMbtaClient({ fetch }),
      clock: fixedClock(WEEKDAY.recordedAt),
      connectionString: testDatabaseUrl(),
    });
    const log = endLogs().find((entry) => entry.job === "collect");
    expect(log).toMatchObject({
      status: "success",
      counts: { vehicles: 106, rejectedRows: 0, unknownStopIds: 0 },
      // 平日 10:20 ET の記録
      inServiceHours: true,
      rejectedRowRatio: 0,
      // 今の運行日に aggregate が成功していない
      aggregateOverdue: true,
    });
  });

  it("今の運行日に aggregate が成功していれば aggregateOverdue は false", async () => {
    await seedStaticFromFixtures(db);
    await db.collectorRun.create({
      data: {
        job: "aggregate",
        status: "success",
        startedAt: new Date("2026-11-02T09:30:00Z"), // 04:30 EST
        finishedAt: new Date("2026-11-02T09:30:05Z"),
      },
    });
    const fetch = fakeMbtaFetch({
      bodies: {
        vehicles: await readFixture(WEEKDAY.vehicles),
        predictions: await readFixture(WEEKDAY.predictions),
        alerts: await readFixture(WEEKDAY.alerts),
      },
    });
    await runCollect({
      db,
      client: createMbtaClient({ fetch }),
      clock: fixedClock(WEEKDAY.recordedAt),
      connectionString: testDatabaseUrl(),
    });
    expect(endLogs().find((entry) => entry.job === "collect")).toMatchObject({
      aggregateOverdue: false,
    });
  });
});
