// TR-007・US5: パーティションの作成と、保持期間を過ぎた生データの削除
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { ensurePartitions, listPartitions } from "@/lib/db/partitions";
import { addServiceDays, serviceDateToDbDate, serviceDayRange } from "@/lib/time";
import { runAggregate } from "@/jobs/aggregate";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";

const db = createTestDb();
/** 2026-11-10 の運行日の日中（10:00 ET） */
const NOW = new Date("2026-11-10T15:00:00Z");
const TODAY = "2026-11-10";

function dates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addServiceDays(d, 1)) out.push(d);
  return out;
}

async function partitionDates(): Promise<string[]> {
  return [...new Set((await listPartitions(db)).map((p) => p.serviceDate))].sort();
}

async function aggregate(retentionDays: number) {
  return runAggregate({
    db,
    clock: fixedClock(NOW),
    connectionString: testDatabaseUrl(),
    retentionDays,
  });
}

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("aggregate ジョブのパーティション管理", () => {
  it("今日から 3 日先までのパーティションを作る", async () => {
    const result = await aggregate(28);
    expect(result.status).toBe("success");
    expect(await partitionDates()).toEqual(dates(TODAY, "2026-11-13"));
    // 3 つの履歴テーブルすべて
    expect(
      (await listPartitions(db))
        .filter((p) => p.serviceDate === TODAY)
        .map((p) => p.table)
        .sort(),
    ).toEqual(["arrival_events", "prediction_samples", "vehicle_positions"]);
  });

  it("保持期間を過ぎ、集計が済んだ運行日だけを削除する。集計が済んでいない日と保持期間内の日は残す", async () => {
    await ensurePartitions(db, dates("2026-11-01", TODAY));
    // 集計の結果: 成功 = 01, 02, 05, 06, 08 / 失敗 = 03 / 記録なし = 04, 07, 09, 10
    await db.aggregateRun.createMany({
      data: [
        ...["2026-11-01", "2026-11-02", "2026-11-05", "2026-11-06", "2026-11-08"].map((d) => ({
          serviceDate: serviceDateToDbDate(d),
          status: "success",
          finishedAt: NOW,
          definitionVersion: 1,
        })),
        {
          serviceDate: serviceDateToDbDate("2026-11-03"),
          status: "failed",
          finishedAt: NOW,
          definitionVersion: 1,
        },
      ],
    });

    // 保持期間 3 日 = 今日（10）と 09, 08 を残す。07 以前が期限切れ
    const result = await aggregate(3);
    expect(result.status).toBe("success");
    expect(await partitionDates()).toEqual([
      "2026-11-03", // 期限切れだが集計が失敗している
      "2026-11-04", // 期限切れだが集計の記録がない
      "2026-11-07", // 期限切れだが集計の記録がない
      ...dates("2026-11-08", "2026-11-13"), // 保持期間内と、これから使う日
    ]);
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ job: "aggregate", status: "success" });
    expect(run.counts).toMatchObject({ droppedServiceDates: 4, keptUnaggregatedServiceDates: 3 });
  });

  it("削除した日の生データは消え、残した日の生データは残る", async () => {
    await ensurePartitions(db, ["2026-11-01", "2026-11-03"]);
    await db.aggregateRun.create({
      data: {
        serviceDate: serviceDateToDbDate("2026-11-01"),
        status: "success",
        finishedAt: NOW,
        definitionVersion: 1,
      },
    });
    const event = (serviceDate: string) => ({
      serviceDate: serviceDateToDbDate(serviceDate),
      tripId: "t1",
      stopId: "place-alfcl",
      routeId: "Red",
      directionId: 0,
      vehicleId: "v1",
      arrivedAt: serviceDayRange(serviceDate).start,
      source: "stopped_at",
      precisionSec: 60,
    });
    await db.arrivalEvent.createMany({ data: [event("2026-11-01"), event("2026-11-03")] });

    await aggregate(3);
    const left = await db.arrivalEvent.findMany();
    expect(left.map((e) => e.serviceDate.toISOString().slice(0, 10))).toEqual(["2026-11-03"]);
  });

  it("保持期間 28 日（prod）では、28 日より前の運行日だけが期限切れ", async () => {
    await ensurePartitions(db, ["2026-10-13", "2026-10-14"]);
    await db.aggregateRun.createMany({
      data: ["2026-10-13", "2026-10-14"].map((d) => ({
        serviceDate: serviceDateToDbDate(d),
        status: "success",
        finishedAt: NOW,
        definitionVersion: 1,
      })),
    });
    await aggregate(28);
    // 10-14 は今日（11-10）を含めて 28 日目なので残る。10-13 は期限切れ
    const kept = await partitionDates();
    expect(kept).toContain("2026-10-14");
    expect(kept).not.toContain("2026-10-13");
  });
});
