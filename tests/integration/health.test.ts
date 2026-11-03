// /api/health の中身（004 T013）: DB への接続、collector の最後の成功、前の運行日の集計
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { createDb } from "@/lib/db/client";
import { checkHealth } from "@/lib/db/health";
import { healthErrorResponseSchema, healthResponseSchema } from "@/lib/api-schemas/health";
import { serviceDateToDbDate } from "@/lib/time";
import { createTestDb, resetData } from "../helpers/db";

const db = createTestDb();
// 2026-11-03 10:00 ET（EST）。運行日は 2026-11-03、前の運行日は 2026-11-02
const clock = fixedClock("2026-11-03T15:00:00Z");

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("checkHealth", () => {
  it("データがなくても DB に接続できれば ok を返す", async () => {
    const result = await checkHealth(db, clock);
    expect(result.ok).toBe(true);
    expect(healthResponseSchema.parse(result.body)).toEqual({
      status: "ok",
      checkedAt: "2026-11-03T15:00:00.000Z",
      lastCollectedAt: null,
      previousServiceDate: "2026-11-02",
      previousServiceDateAggregated: false,
    });
  });

  it("collector の最後の成功時刻と前の運行日の集計を返す", async () => {
    await db.collectorRun.createMany({
      data: [
        {
          job: "collect",
          status: "success",
          startedAt: new Date("2026-11-03T14:58:00Z"),
          finishedAt: new Date("2026-11-03T14:58:04Z"),
        },
        // 後の失敗と他のジョブの成功は無視する
        {
          job: "collect",
          status: "failed",
          startedAt: new Date("2026-11-03T14:59:00Z"),
          finishedAt: new Date("2026-11-03T14:59:02Z"),
        },
        {
          job: "sync-static",
          status: "success",
          startedAt: new Date("2026-11-03T14:59:30Z"),
          finishedAt: new Date("2026-11-03T14:59:40Z"),
        },
      ],
    });
    await db.aggregateRun.create({
      data: {
        serviceDate: serviceDateToDbDate("2026-11-02"),
        status: "success",
        finishedAt: new Date("2026-11-03T09:31:00Z"),
        definitionVersion: 1,
      },
    });

    const result = await checkHealth(db, clock);
    expect(result.body).toMatchObject({
      status: "ok",
      lastCollectedAt: "2026-11-03T14:58:04.000Z",
      previousServiceDateAggregated: true,
    });
  });

  it("前の運行日の集計が成功していなければ false", async () => {
    await db.aggregateRun.create({
      data: {
        serviceDate: serviceDateToDbDate("2026-11-02"),
        status: "running",
        definitionVersion: 1,
      },
    });
    const result = await checkHealth(db, clock);
    expect(result.body).toMatchObject({ previousServiceDateAggregated: false });
  });

  it("運行日の境界（03:00 ET）の前は、前の運行日が 1 日ずれる", async () => {
    // 2026-11-03 02:30 ET は運行日 2026-11-02 に属する
    const result = await checkHealth(db, fixedClock("2026-11-03T07:30:00Z"));
    expect(result.body).toMatchObject({ previousServiceDate: "2026-11-01" });
  });

  it("DB に接続できなければ ok: false を返す（例外を投げない）", async () => {
    const unreachable = createDb("postgresql://postgres@127.0.0.1:1/none");
    try {
      const result = await checkHealth(unreachable, clock);
      expect(result.ok).toBe(false);
      expect(healthErrorResponseSchema.parse(result.body)).toEqual({
        status: "error",
        checkedAt: "2026-11-03T15:00:00.000Z",
      });
    } finally {
      await unreachable.$disconnect();
    }
  });
});
