// 003 T006・TR-004: aggregate ジョブの集計の骨組み（運行日の選び方、冪等性、aggregate_runs、失敗の扱い）。
// 指標ごとの集計は各ユーザーストーリーで足すので、ここでは差し替えた集計（テスト用）で確かめる
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import type { MetricAggregator } from "@/lib/db/aggregate";
import { ensurePartitions, listPartitions } from "@/lib/db/partitions";
import { AGGREGATE_DEFINITION_VERSION } from "@/lib/metrics/constants";
import { serviceDateToDbDate } from "@/lib/time";
import {
  parseAggregateArgs,
  runAggregate,
  serviceDatesToAggregate,
  type AggregateRange,
} from "@/jobs/aggregate";
import { insertAnalyticsSeed } from "../helpers/analytics-seed";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { seedStaticFromFixtures } from "../helpers/seed";

const db = createTestDb();
/** 2026-11-10（火）の 04:30 ET（aggregate ジョブが動く時刻） */
const NOW = new Date("2026-11-10T09:30:00Z");

/** テスト用の集計: その運行日の行を daily_alert_stats に 2 行入れる */
const fakeAggregator: MetricAggregator = {
  name: "fake",
  tables: ["daily_alert_stats"],
  async run(tx, serviceDate) {
    const date = serviceDateToDbDate(serviceDate);
    await tx.dailyAlertStat.createMany({
      data: ["Red", "Blue"].map((routeId) => ({
        serviceDate: date,
        routeId,
        effect: "DELAY",
        cause: "UNKNOWN_CAUSE",
        alertCount: 1,
        activeMinutes: 10,
      })),
    });
    return 2;
  },
};

/** 指定の運行日で失敗する集計 */
function failingOn(badDate: string): MetricAggregator {
  return {
    ...fakeAggregator,
    async run(tx, serviceDate) {
      const n = await fakeAggregator.run(tx, serviceDate);
      if (serviceDate === badDate) throw new Error("テスト用の失敗");
      return n;
    },
  };
}

function run(aggregators: MetricAggregator[], range?: AggregateRange, retentionDays = 28) {
  return runAggregate({
    db,
    clock: fixedClock(NOW),
    connectionString: testDatabaseUrl(),
    retentionDays,
    range,
    aggregators,
  });
}

async function runs() {
  return (await db.aggregateRun.findMany({ orderBy: { serviceDate: "asc" } })).map((r) => ({
    serviceDate: r.serviceDate.toISOString().slice(0, 10),
    status: r.status,
    definitionVersion: r.definitionVersion,
  }));
}

async function statDates() {
  const rows = await db.dailyAlertStat.findMany({ orderBy: [{ serviceDate: "asc" }] });
  return rows.map((r) => r.serviceDate.toISOString().slice(0, 10));
}

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("集計する運行日", () => {
  it("既定は前の運行日だけ", () => {
    expect(serviceDatesToAggregate("2026-11-10")).toEqual(["2026-11-09"]);
  });

  it("期間は古い順。今日以降と、from > to は例外", () => {
    expect(serviceDatesToAggregate("2026-11-10", { from: "2026-11-07", to: "2026-11-09" })).toEqual(
      ["2026-11-07", "2026-11-08", "2026-11-09"],
    );
    expect(() =>
      serviceDatesToAggregate("2026-11-10", { from: "2026-11-09", to: "2026-11-10" }),
    ).toThrow();
    expect(() =>
      serviceDatesToAggregate("2026-11-10", { from: "2026-11-09", to: "2026-11-08" }),
    ).toThrow();
    expect(() =>
      serviceDatesToAggregate("2026-11-10", { from: "2026-01-01", to: "2026-11-09" }),
    ).toThrow();
  });

  it("コマンドラインの --from / --to", () => {
    expect(parseAggregateArgs([])).toBeUndefined();
    expect(parseAggregateArgs(["--from", "2026-11-01", "--to", "2026-11-03"])).toEqual({
      from: "2026-11-01",
      to: "2026-11-03",
    });
    expect(() => parseAggregateArgs(["--from", "2026-11-01"])).toThrow();
    expect(() => parseAggregateArgs(["--from", "2026-13-01", "--to", "2026-13-02"])).toThrow();
    expect(() => parseAggregateArgs(["--unknown", "x"])).toThrow();
  });
});

describe("aggregate ジョブの集計", () => {
  it("前の運行日を集計して、aggregate_runs に success と定義の版を記録する", async () => {
    const result = await run([fakeAggregator]);
    expect(result.status).toBe("success");
    expect(await runs()).toEqual([
      {
        serviceDate: "2026-11-09",
        status: "success",
        definitionVersion: AGGREGATE_DEFINITION_VERSION,
      },
    ]);
    expect(await statDates()).toEqual(["2026-11-09", "2026-11-09"]);
    const jobRun = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(jobRun.counts).toMatchObject({ aggregatedServiceDates: 1, fakeRows: 2 });
  });

  it("期間を指定すると古い順に集計する", async () => {
    await run([fakeAggregator], { from: "2026-11-06", to: "2026-11-08" });
    expect((await runs()).map((r) => r.serviceDate)).toEqual([
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("同じ運行日を 2 回集計しても行は変わらない（冪等）", async () => {
    await run([fakeAggregator]);
    const first = await db.dailyAlertStat.findMany({ orderBy: { routeId: "asc" } });
    await run([fakeAggregator]);
    const second = await db.dailyAlertStat.findMany({ orderBy: { routeId: "asc" } });
    expect(second).toEqual(first);
    expect(await runs()).toHaveLength(1);
  });

  it("集計に失敗した運行日は failed を記録し、その日の行は前のまま。ほかの日は集計し、ジョブは失敗にする", async () => {
    await run([fakeAggregator], { from: "2026-11-07", to: "2026-11-08" });
    const result = await run([failingOn("2026-11-07")], { from: "2026-11-06", to: "2026-11-08" });
    expect(result.status).toBe("failed");
    expect(await runs()).toEqual([
      {
        serviceDate: "2026-11-06",
        status: "success",
        definitionVersion: AGGREGATE_DEFINITION_VERSION,
      },
      {
        serviceDate: "2026-11-07",
        status: "failed",
        definitionVersion: AGGREGATE_DEFINITION_VERSION,
      },
      {
        serviceDate: "2026-11-08",
        status: "success",
        definitionVersion: AGGREGATE_DEFINITION_VERSION,
      },
    ]);
    // 失敗した日（07）はトランザクションが戻り、前回の 2 行が残る
    expect(await statDates()).toEqual([
      "2026-11-06",
      "2026-11-06",
      "2026-11-07",
      "2026-11-07",
      "2026-11-08",
      "2026-11-08",
    ]);
  });

  it("集計に失敗した運行日の生データは、保持期間を過ぎても消さない", async () => {
    await ensurePartitions(db, ["2026-11-06", "2026-11-07"]);
    // 06 は版 1 で集計済み（消してよい）、07 は今回失敗する
    await db.aggregateRun.create({
      data: {
        serviceDate: serviceDateToDbDate("2026-11-06"),
        status: "success",
        finishedAt: NOW,
        definitionVersion: 1,
      },
    });
    await run([failingOn("2026-11-07")], { from: "2026-11-07", to: "2026-11-07" }, 3);
    const dates = new Set((await listPartitions(db)).map((p) => p.serviceDate));
    expect(dates.has("2026-11-06")).toBe(false);
    expect(dates.has("2026-11-07")).toBe(true);
  });
});

describe("登録済みの指標の集計（既定の aggregators）", () => {
  it("運行間隔・予測精度・アラート: 前の運行日の行を入れ、2 回目も同じ行になる", async () => {
    await seedStaticFromFixtures(db);
    await insertAnalyticsSeed(db, "2026-11-09", "2026-11-09");
    const first = await runAggregate({
      db,
      clock: fixedClock(NOW),
      connectionString: testDatabaseUrl(),
      retentionDays: 28,
    });
    expect(first.status).toBe("success");
    const rows = await db.dailyHeadwayStat.findMany({
      orderBy: [{ routeId: "asc" }, { directionId: "asc" }, { stopId: "asc" }, { hour: "asc" }],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.serviceDate.toISOString().slice(0, 10)))).toEqual(
      new Set(["2026-11-09"]),
    );
    const jobRun = await db.collectorRun.findUniqueOrThrow({ where: { id: first.runId } });
    expect(jobRun.counts).toMatchObject({ headwaysRows: rows.length });
    // 予測精度も同じ運行日の分が入る
    const accuracy = await db.dailyPredictionAccuracy.count();
    expect(accuracy).toBeGreaterThan(0);
    expect(jobRun.counts).toMatchObject({ predictionAccuracyRows: accuracy });
    // アラート（テスト用データにはないので 0 行）も登録されている
    expect(jobRun.counts).toMatchObject({ alertsRows: 0 });

    await runAggregate({
      db,
      clock: fixedClock(NOW),
      connectionString: testDatabaseUrl(),
      retentionDays: 28,
    });
    const again = await db.dailyHeadwayStat.findMany({
      orderBy: [{ routeId: "asc" }, { directionId: "asc" }, { stopId: "asc" }, { hour: "asc" }],
    });
    expect(again).toEqual(rows);
  });
});
