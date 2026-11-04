// 003 TR-001: 予測誤差の指標（TypeScript 版）
import { describe, expect, it } from "vitest";
import {
  accuracyValues,
  combineAccuracy,
  groupAccuracy,
  predictionAccuracy,
  predictionErrorSec,
  type AccuracyArrival,
  type AccuracySample,
} from "@/lib/metrics/prediction-accuracy";

/** 2026-11-02（月）10:00 ET からの秒 */
const at = (sec: number) => new Date(Date.UTC(2026, 10, 2, 15, 0, sec));

function sample(over: Partial<AccuracySample> & { predictedSec: number }): AccuracySample {
  const { predictedSec, ...rest } = over;
  return {
    serviceDate: "2026-11-02",
    tripId: "t1",
    stopId: "place-pktrm",
    leadBucketMin: 5,
    routeId: "Red",
    directionId: 0,
    updateType: "MID_TRIP",
    predictedArrivalAt: at(predictedSec),
    ...rest,
  };
}

function arrival(over: Partial<AccuracyArrival> & { arrivedSec: number }): AccuracyArrival {
  const { arrivedSec, ...rest } = over;
  return {
    serviceDate: "2026-11-02",
    tripId: "t1",
    stopId: "place-pktrm",
    arrivedAt: at(arrivedSec),
    source: "stopped_at",
    ...rest,
  };
}

describe("predictionErrorSec", () => {
  it("正 = 予測より遅く到着、負 = 早く到着", () => {
    expect(predictionErrorSec(at(100), at(70))).toBe(30);
    expect(predictionErrorSec(at(70), at(100))).toBe(-30);
  });
});

describe("accuracyValues", () => {
  it("平均誤差・平均絶対誤差・p90・±60 秒以内の割合（60 秒ちょうどを含む）", () => {
    expect(accuracyValues([60, -60, 61, -10])).toEqual({
      n: 4,
      meanErrorSec: 51 / 4,
      meanAbsErrorSec: 191 / 4,
      // |誤差| を並べると 10, 60, 60, 61 → p90 は 60 + (61 − 60) × 0.7
      p90AbsErrorSec: 60.7,
      within60sRatio: 0.75,
    });
  });
});

describe("predictionAccuracy", () => {
  it("(運行日, 便, 親駅) で到着と突き合わせ、時間帯は実際の到着の ET の時", () => {
    const rows = predictionAccuracy(
      [sample({ predictedSec: 0 }), sample({ tripId: "t2", predictedSec: 0 })],
      [arrival({ arrivedSec: 30 }), arrival({ tripId: "t2", arrivedSec: -90 })],
    );
    // t1: +30 秒（10 時台）、t2: −90 秒（到着は 9:58:30 で 9 時台）
    expect(rows.map((r) => [r.hour, r.n, r.meanErrorSec])).toEqual([
      [9, 1, -90],
      [10, 1, 30],
    ]);
  });

  it("補間した到着と、到着のない予測は除く", () => {
    const rows = predictionAccuracy(
      [
        sample({ predictedSec: 0 }),
        sample({ tripId: "interp", predictedSec: 0 }),
        sample({ tripId: "none", predictedSec: 0 }),
        sample({ stopId: "place-dwnxg", predictedSec: 0 }),
      ],
      [
        arrival({ arrivedSec: 10 }),
        arrival({ tripId: "interp", arrivedSec: 10, source: "interpolated" }),
      ],
    );
    expect(rows.map((r) => r.n)).toEqual([1]);
  });

  it("運行日が違えば突き合わせない", () => {
    const rows = predictionAccuracy(
      [sample({ predictedSec: 0 })],
      [arrival({ serviceDate: "2026-11-03", arrivedSec: 10 })],
    );
    expect(rows).toEqual([]);
  });

  it("リード時間と予測の種類ごとに分け、種類が空なら UNKNOWN", () => {
    const rows = predictionAccuracy(
      [
        sample({ leadBucketMin: 1, predictedSec: 0 }),
        sample({ leadBucketMin: 10, predictedSec: 0 }),
        sample({ tripId: "t2", updateType: null, predictedSec: 0 }),
        sample({ tripId: "t3", updateType: "AT_TERMINAL", predictedSec: 0 }),
      ],
      ["t1", "t2", "t3"].map((tripId) => arrival({ tripId, arrivedSec: 5 })),
    );
    expect(rows.map((r) => [r.leadBucketMin, r.updateType, r.n])).toEqual([
      [1, "MID_TRIP", 1],
      [5, "AT_TERMINAL", 1],
      [5, "UNKNOWN", 1],
      [10, "MID_TRIP", 1],
    ]);
  });
});

describe("combineAccuracy / groupAccuracy", () => {
  const v = (n: number, meanErrorSec: number, within60sRatio: number) => ({
    n,
    meanErrorSec,
    meanAbsErrorSec: Math.abs(meanErrorSec),
    p90AbsErrorSec: Math.abs(meanErrorSec) * 2,
    within60sRatio,
  });

  it("件数で重み付けしてまとめる。空なら null", () => {
    expect(combineAccuracy([v(1, 10, 1), v(3, -30, 0.5)])).toEqual({
      n: 4,
      meanErrorSec: -20,
      meanAbsErrorSec: 25,
      p90AbsErrorSec: 50,
      within60sRatio: 0.625,
    });
    expect(combineAccuracy([])).toBeNull();
  });

  it("キーごとにまとめる", () => {
    const g = groupAccuracy(
      [
        { lead: 1, ...v(1, 10, 1) },
        { lead: 5, ...v(1, 50, 1) },
        { lead: 1, ...v(1, 30, 0) },
      ],
      (r) => r.lead,
    );
    expect([...g.keys()]).toEqual([1, 5]);
    expect(g.get(1)).toMatchObject({ n: 2, meanErrorSec: 20, within60sRatio: 0.5 });
  });
});
