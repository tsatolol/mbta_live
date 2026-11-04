// 003 TR-002: 予測誤差の集計 SQL と TypeScript 版が、同じデータで同じ結果になる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computePredictionAccuracy } from "@/lib/db/analytics-sql";
import { ensurePartitions } from "@/lib/db/partitions";
import {
  accuracyKeyString,
  predictionAccuracy,
  type AccuracyRow,
} from "@/lib/metrics/prediction-accuracy";
import { serviceDateToDbDate, type ServiceDate } from "@/lib/time";
import { insertAnalyticsSeed } from "../../helpers/analytics-seed";
import { createTestDb, resetData } from "../../helpers/db";

const db = createTestDb();
const day = (d: Date) => d.toISOString().slice(0, 10);

async function expectSameAsTypeScript(serviceDate: ServiceDate): Promise<AccuracyRow[]> {
  const date = serviceDateToDbDate(serviceDate);
  const [sql, samples, arrivals] = await Promise.all([
    computePredictionAccuracy(db, serviceDate),
    db.predictionSample.findMany({ where: { serviceDate: date } }),
    db.arrivalEvent.findMany({ where: { serviceDate: date } }),
  ]);
  const ts = predictionAccuracy(
    samples.map((s) => ({ ...s, serviceDate: day(s.serviceDate) })),
    arrivals.map((a) => ({ ...a, serviceDate: day(a.serviceDate) })),
  );
  const fromSql: AccuracyRow[] = sql
    .map((r) => ({
      routeId: r.route_id,
      directionId: r.direction_id,
      leadBucketMin: r.lead_bucket_min,
      updateType: r.update_type,
      hour: r.hour,
      n: r.n,
      meanErrorSec: r.mean_error_sec,
      meanAbsErrorSec: r.mean_abs_error_sec,
      p90AbsErrorSec: r.p90_abs_error_sec,
      within60sRatio: r.within_60s_ratio,
    }))
    .sort((a, b) => (accuracyKeyString(a) < accuracyKeyString(b) ? -1 : 1));
  expect(fromSql.map(accuracyKeyString)).toEqual(ts.map(accuracyKeyString));
  fromSql.forEach((row, i) => {
    const t = ts[i]!;
    expect(row.n).toBe(t.n);
    expect(row.meanErrorSec).toBeCloseTo(t.meanErrorSec, 6);
    expect(row.meanAbsErrorSec).toBeCloseTo(t.meanAbsErrorSec, 6);
    expect(row.p90AbsErrorSec).toBeCloseTo(t.p90AbsErrorSec, 6);
    expect(row.within60sRatio).toBeCloseTo(t.within60sRatio, 10);
  });
  return fromSql;
}

beforeAll(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("予測誤差の集計 SQL と TypeScript 版の一致", () => {
  it("テスト用データの 1 日", async () => {
    await insertAnalyticsSeed(db, "2026-11-02", "2026-11-02");
    const rows = await expectSameAsTypeScript("2026-11-02");
    expect(new Set(rows.map((r) => r.updateType))).toEqual(new Set(["MID_TRIP", "AT_TERMINAL"]));
    // テスト用データの誤差は「リード時間 × 10 秒」: 1・3・5 分は ±60 秒以内、10・15 分は外
    const byLead = (lead: number) => rows.filter((r) => r.leadBucketMin === lead);
    for (const r of byLead(5)) expect(r.within60sRatio).toBe(1);
    for (const r of byLead(10)) expect(r.within60sRatio).toBe(0);
    for (const r of byLead(15)) expect(r.meanAbsErrorSec).toBeCloseTo(150, 6);
  });

  it("補間の到着・到着のない予測・種類が空の予測・符号", async () => {
    const d = "2026-11-12";
    await ensurePartitions(db, [d]);
    const date = serviceDateToDbDate(d);
    const base = new Date("2026-11-12T15:00:00Z");
    const plus = (sec: number) => new Date(base.getTime() + sec * 1000);
    await db.arrivalEvent.createMany({
      data: [
        { tripId: "late", source: "stopped_at" },
        { tripId: "early", source: "predicted_last" },
        { tripId: "interp", source: "interpolated" },
      ].map((a) => ({
        ...a,
        serviceDate: date,
        stopId: "place-pktrm",
        routeId: "Red",
        directionId: 0,
        vehicleId: null,
        arrivedAt: base,
        precisionSec: 60,
      })),
    });
    await db.predictionSample.createMany({
      data: [
        { tripId: "late", predictedArrivalAt: plus(-45), updateType: null },
        { tripId: "early", predictedArrivalAt: plus(90), updateType: null },
        { tripId: "interp", predictedArrivalAt: plus(0), updateType: null },
        { tripId: "missing", predictedArrivalAt: plus(0), updateType: "MID_TRIP" },
      ].map((p) => ({
        ...p,
        serviceDate: date,
        stopId: "place-pktrm",
        leadBucketMin: 3,
        routeId: "Red",
        directionId: 0,
        uncertaintySec: null,
        observedAt: plus(-180),
      })),
    });
    const rows = await expectSameAsTypeScript(d);
    expect(rows).toEqual([
      expect.objectContaining({
        updateType: "UNKNOWN",
        hour: 10,
        n: 2,
        meanErrorSec: (45 - 90) / 2,
        meanAbsErrorSec: (45 + 90) / 2,
        within60sRatio: 0.5,
      }),
    ]);
  });

  it("データが 0 件の日は行がない", async () => {
    await ensurePartitions(db, ["2026-11-20"]);
    expect(await expectSameAsTypeScript("2026-11-20")).toEqual([]);
  });
});
