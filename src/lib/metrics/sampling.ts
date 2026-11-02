// 予測のサンプリング（specs/001-data-collection/data-model.md の「予測のサンプリング」）。副作用のない純粋関数
import { serviceDateOf, type ServiceDate } from "@/lib/time";
import { LEAD_BUCKETS_MIN } from "./constants";
import type { StopIndex } from "./stop-index";

export type LeadBucketMin = (typeof LEAD_BUCKETS_MIN)[number];

/** サンプリングに使う予測の情報（今回取得した予測） */
export interface SamplingPrediction {
  routeId: string;
  tripId: string;
  stopId: string;
  directionId: number;
  arrivalTime: Date | null;
  scheduleRelationship: string | null;
  updateType: string | null;
  uncertaintySec: number | null;
}

export interface PredictionSampleRow {
  /** 予測到着時刻の運行日（到着イベントと突き合わせるため） */
  serviceDate: ServiceDate;
  tripId: string;
  /** 親駅 */
  stopId: string;
  leadBucketMin: LeadBucketMin;
  routeId: string;
  directionId: number;
  updateType: string | null;
  uncertaintySec: number | null;
  predictedArrivalAt: Date;
  observedAt: Date;
}

const NOT_SERVED = new Set(["CANCELLED", "SKIPPED"]);

/**
 * リード時間（秒）が入るバケットを返す。リード時間以上で最小のバケット。
 * 0 以下（すでに過ぎた）か、最大のバケット（15 分）を超えるときは null
 */
export function bucketForLead(leadSec: number): LeadBucketMin | null {
  if (leadSec <= 0) return null;
  return LEAD_BUCKETS_MIN.find((b) => leadSec <= b * 60) ?? null;
}

/**
 * 今回の予測からサンプルの行を作る。DB には（運行日, 便, 親駅, バケット）ごとに最初の 1 件だけが残る。
 * CANCELLED / SKIPPED、arrival_time が null（始発駅）、リード時間がバケットの範囲外、駅の索引にないホームの予測は除く
 */
export function toPredictionSamples(
  predictions: readonly SamplingPrediction[],
  observedAt: Date,
  index: StopIndex,
): PredictionSampleRow[] {
  const rows = new Map<string, PredictionSampleRow>();
  for (const p of predictions) {
    if (p.arrivalTime === null) continue;
    if (p.scheduleRelationship !== null && NOT_SERVED.has(p.scheduleRelationship)) continue;
    const bucket = bucketForLead((p.arrivalTime.getTime() - observedAt.getTime()) / 1000);
    if (bucket === null) continue;
    const station = index.parentOf(p.stopId);
    if (station === null) continue;
    const serviceDate = serviceDateOf(p.arrivalTime);
    const key = `${serviceDate}|${p.tripId}|${station}|${bucket}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      serviceDate,
      tripId: p.tripId,
      stopId: station,
      leadBucketMin: bucket,
      routeId: p.routeId,
      directionId: p.directionId,
      updateType: p.updateType,
      uncertaintySec: p.uncertaintySec,
      predictedArrivalAt: p.arrivalTime,
      observedAt,
    });
  }
  return [...rows.values()];
}
