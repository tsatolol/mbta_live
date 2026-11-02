// パーティションの作成（T021）
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPartitionSql, ensurePartitions, listPartitions } from "@/lib/db/partitions";
import { createTestDb, resetData } from "../helpers/db";

const db = createTestDb();

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("ensurePartitions", () => {
  it("3 つの履歴テーブルについて、運行日ごとの子テーブルを partitions スキーマに作る", async () => {
    await ensurePartitions(db, ["2026-11-02", "2026-11-03"]);
    const parts = await listPartitions(db);
    expect(parts.map((p) => p.name).sort()).toEqual([
      "arrival_events_p20261102",
      "arrival_events_p20261103",
      "prediction_samples_p20261102",
      "prediction_samples_p20261103",
      "vehicle_positions_p20261102",
      "vehicle_positions_p20261103",
    ]);
  });

  it("2 回呼んでもエラーにならない", async () => {
    await ensurePartitions(db, ["2026-11-02"]);
    await ensurePartitions(db, ["2026-11-02"]);
    expect(await listPartitions(db)).toHaveLength(3);
  });

  it("vehicle_positions の範囲は運行日の境界（ET 03:00）に合う", async () => {
    await ensurePartitions(db, ["2026-11-02"]);
    const base = {
      routeId: "Red",
      lat: 42.3,
      lon: -71.1,
      currentStatus: "IN_TRANSIT_TO",
      polledAt: new Date(),
    };
    // 2026-11-02 の運行日の最後（翌 02:59 ET）は入る
    await db.vehiclePosition.create({
      data: { ...base, vehicleId: "v1", updatedAt: new Date("2026-11-03T07:59:00Z") },
    });
    // 翌日の 03:00 ET は 2026-11-03 の運行日なので、パーティションがなく入らない
    await expect(
      db.vehiclePosition.create({
        data: { ...base, vehicleId: "v2", updatedAt: new Date("2026-11-03T08:00:00Z") },
      }),
    ).rejects.toThrow();
  });

  it("夏時間の終了を含む運行日は 25 時間の範囲になる", () => {
    expect(createPartitionSql("vehicle_positions", "2026-10-31")).toContain(
      "FROM ('2026-10-31T07:00:00.000Z') TO ('2026-11-01T08:00:00.000Z')",
    );
    expect(createPartitionSql("arrival_events", "2026-10-31")).toContain(
      "FROM ('2026-10-31') TO ('2026-11-01')",
    );
  });

  it("運行日の形式が正しくなければ SQL を作らない", () => {
    expect(() => createPartitionSql("arrival_events", "2026-11-02'; DROP TABLE x; --")).toThrow();
  });
});
