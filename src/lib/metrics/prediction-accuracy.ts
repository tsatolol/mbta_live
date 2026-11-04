// 到着予測の精度（003 US2）の指標の TypeScript 版。純粋関数（specs/003-analytics/data-model.md の「予測誤差」）。
// 集計は SQL（src/lib/db/analytics-sql.ts）で行い、この関数とは小さなデータで結果を突き合わせる（TR-002）
import { PREDICTION_WITHIN_SEC } from "./constants";
import { percentileCont } from "./headways";
import { bostonHourOf, type ServiceDate } from "@/lib/time";

/** 予測の種類が空のときの値 */
export const UNKNOWN_UPDATE_TYPE = "UNKNOWN";

/** 画面で選べる予測の種類 */
export const UPDATE_TYPES = [
  "MID_TRIP",
  "AT_TERMINAL",
  "REVERSE_TRIP",
  UNKNOWN_UPDATE_TYPE,
] as const;

export interface AccuracySample {
  serviceDate: ServiceDate;
  tripId: string;
  /** 親駅 */
  stopId: string;
  leadBucketMin: number;
  routeId: string;
  directionId: number;
  updateType: string | null;
  predictedArrivalAt: Date;
}

export interface AccuracyArrival {
  serviceDate: ServiceDate;
  tripId: string;
  stopId: string;
  arrivedAt: Date;
  source: string;
}

export interface AccuracyKey {
  routeId: string;
  directionId: number;
  leadBucketMin: number;
  updateType: string;
  hour: number;
}

export interface AccuracyValues {
  n: number;
  /** 平均誤差（バイアス）。正 = 予測より遅く到着 */
  meanErrorSec: number;
  meanAbsErrorSec: number;
  p90AbsErrorSec: number;
  /** 誤差が ±PREDICTION_WITHIN_SEC 以内（ちょうどを含む）の割合 */
  within60sRatio: number;
}

export type AccuracyRow = AccuracyKey & AccuracyValues;

/** 予測誤差（秒）: 実際の到着 − 予測した到着。正 = 予測より遅く到着 */
export function predictionErrorSec(actual: Date, predicted: Date): number {
  return (actual.getTime() - predicted.getTime()) / 1000;
}

/**
 * 1 つの運行日の予測サンプルと到着から、(路線, 方向, リード時間, 予測の種類, 時間帯) ごとの精度を作る。
 * - 予測は (運行日, 便, 親駅) で到着と突き合わせる。到着のない予測は除く
 * - 補間（interpolated）で推定した到着は除く
 * - 時間帯は実際の到着の ET の時。予測の種類が空なら UNKNOWN
 */
export function predictionAccuracy(
  samples: readonly AccuracySample[],
  arrivals: readonly AccuracyArrival[],
): AccuracyRow[] {
  const arrivalByKey = new Map<string, AccuracyArrival>();
  for (const a of arrivals) {
    if (a.source === "interpolated") continue;
    arrivalByKey.set(`${a.serviceDate}|${a.tripId}|${a.stopId}`, a);
  }
  const groups = new Map<string, { key: AccuracyKey; errors: number[] }>();
  for (const s of samples) {
    const arrival = arrivalByKey.get(`${s.serviceDate}|${s.tripId}|${s.stopId}`);
    if (!arrival) continue;
    const key: AccuracyKey = {
      routeId: s.routeId,
      directionId: s.directionId,
      leadBucketMin: s.leadBucketMin,
      updateType: s.updateType ?? UNKNOWN_UPDATE_TYPE,
      hour: bostonHourOf(arrival.arrivedAt),
    };
    const k = accuracyKeyString(key);
    const entry = groups.get(k) ?? { key, errors: [] };
    entry.errors.push(predictionErrorSec(arrival.arrivedAt, s.predictedArrivalAt));
    groups.set(k, entry);
  }
  return [...groups.values()]
    .map(({ key, errors }) => ({ ...key, ...accuracyValues(errors) }))
    .sort((a, b) => (accuracyKeyString(a) < accuracyKeyString(b) ? -1 : 1));
}

export function accuracyKeyString(k: AccuracyKey): string {
  return `${k.routeId}|${k.directionId}|${String(k.leadBucketMin).padStart(2, "0")}|${k.updateType}|${String(k.hour).padStart(2, "0")}`;
}

/** 誤差（秒）の一覧から統計を作る。空なら n = 0 で値は NaN */
export function accuracyValues(errors: readonly number[]): AccuracyValues {
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  const n = errors.length;
  return {
    n,
    meanErrorSec: errors.reduce((s, e) => s + e, 0) / n,
    meanAbsErrorSec: abs.reduce((s, e) => s + e, 0) / n,
    p90AbsErrorSec: percentileCont(abs, 0.9),
    within60sRatio: abs.filter((e) => e <= PREDICTION_WITHIN_SEC).length / n,
  };
}

/**
 * 複数の行を 1 つにまとめる。平均誤差・平均絶対誤差・±60 秒の割合は正確（件数で重み付け）。
 * p90 は件数で重み付けした平均（近似）。空なら null
 */
export function combineAccuracy(rows: readonly AccuracyValues[]): AccuracyValues | null {
  const n = rows.reduce((s, r) => s + r.n, 0);
  if (n === 0) return null;
  const weighted = (f: (r: AccuracyValues) => number) =>
    rows.reduce((s, r) => s + f(r) * r.n, 0) / n;
  return {
    n,
    meanErrorSec: weighted((r) => r.meanErrorSec),
    meanAbsErrorSec: weighted((r) => r.meanAbsErrorSec),
    p90AbsErrorSec: weighted((r) => r.p90AbsErrorSec),
    within60sRatio: weighted((r) => r.within60sRatio),
  };
}

/** キーごとにまとめる（Map の順は、最初に現れた順） */
export function groupAccuracy<T extends AccuracyValues, K>(
  rows: readonly T[],
  keyOf: (r: T) => K,
): Map<K, AccuracyValues> {
  const groups = new Map<K, T[]>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  const out = new Map<K, AccuracyValues>();
  for (const [k, list] of groups) {
    const c = combineAccuracy(list);
    if (c) out.set(k, c);
  }
  return out;
}
