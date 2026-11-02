// TR-003: 予測のサンプリング
import { describe, expect, it } from "vitest";
import {
  bucketForLead,
  toPredictionSamples,
  type SamplingPrediction,
} from "@/lib/metrics/sampling";
import { at, index, T0 } from "../../helpers/arrival-fixtures";

function pred(
  arrivalTime: Date | null,
  overrides: Partial<SamplingPrediction> = {},
): SamplingPrediction {
  return {
    routeId: "R",
    tripId: "t1",
    stopId: "c1",
    directionId: 0,
    arrivalTime,
    scheduleRelationship: null,
    updateType: "MID_TRIP",
    uncertaintySec: 60,
    ...overrides,
  };
}

describe("bucketForLead", () => {
  it.each([
    [15 * 60 + 1, null],
    [15 * 60, 15],
    [11 * 60, 15],
    [10 * 60, 10],
    [5 * 60 + 30, 10],
    [5 * 60, 5],
    [4 * 60, 5],
    [3 * 60, 3],
    [2 * 60, 3],
    [61, 3],
    [60, 1],
    [1, 1],
    [0, null],
    [-30, null],
  ])("リード時間 %i 秒 → バケット %s 分", (leadSec, expected) => {
    expect(bucketForLead(leadSec)).toBe(expected);
  });
});

describe("toPredictionSamples", () => {
  it("予測を、親駅・運行日・バケット付きのサンプルにする", () => {
    const samples = toPredictionSamples([pred(at(4 * 60))], T0, index);
    expect(samples).toEqual([
      {
        serviceDate: "2026-11-02",
        tripId: "t1",
        stopId: "place-c",
        leadBucketMin: 5,
        routeId: "R",
        directionId: 0,
        updateType: "MID_TRIP",
        uncertaintySec: 60,
        predictedArrivalAt: at(4 * 60),
        observedAt: T0,
      },
    ]);
  });

  it("CANCELLED / SKIPPED と、arrival_time が null の予測（始発駅）は保存しない", () => {
    expect(
      toPredictionSamples([pred(at(60), { scheduleRelationship: "CANCELLED" })], T0, index),
    ).toEqual([]);
    expect(
      toPredictionSamples([pred(at(60), { scheduleRelationship: "SKIPPED" })], T0, index),
    ).toEqual([]);
    expect(toPredictionSamples([pred(null)], T0, index)).toEqual([]);
    // ADDED（時刻表にない便）は保存する
    expect(
      toPredictionSamples([pred(at(60), { scheduleRelationship: "ADDED" })], T0, index),
    ).toHaveLength(1);
  });

  it("リード時間が 15 分を超える予測と、すでに過ぎた予測は保存しない", () => {
    expect(toPredictionSamples([pred(at(16 * 60)), pred(at(-10)), pred(T0)], T0, index)).toEqual(
      [],
    );
  });

  it("駅の索引にないホームの予測は保存しない", () => {
    expect(toPredictionSamples([pred(at(60), { stopId: "X9" })], T0, index)).toEqual([]);
  });

  it("到着の 16 分前から 0 分前まで 1 分ごとに観測すると、バケットごとに最初の 1 件だけが残る", () => {
    const arrival = at(16 * 60);
    // DB の主キー（運行日, 便, 親駅, バケット）と同じく、最初の観測を残す
    const kept = new Map<number, Date>();
    for (let minute = 0; minute <= 16; minute++) {
      const observedAt = at(minute * 60);
      for (const s of toPredictionSamples([pred(arrival)], observedAt, index)) {
        if (!kept.has(s.leadBucketMin)) kept.set(s.leadBucketMin, s.observedAt);
      }
    }
    // 各バケットは、リード時間がちょうどバケットの分数になった時点で最初に観測される
    expect([...kept.entries()].sort(([a], [b]) => a - b)).toEqual([
      [1, at(15 * 60)],
      [3, at(13 * 60)],
      [5, at(11 * 60)],
      [10, at(6 * 60)],
      [15, at(1 * 60)],
    ]);
  });
});
