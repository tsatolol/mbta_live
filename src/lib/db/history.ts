// 履歴テーブル（生データ）への書き込み
import type { ArrivalEventRow } from "@/lib/metrics/arrivals";
import type { PredictionSampleRow } from "@/lib/metrics/sampling";
import type { Vehicle } from "@/lib/mbta/schemas/vehicle";
import { serviceDateToDbDate } from "@/lib/time";
import type { DbTx } from "./types";

/**
 * 車両位置の履歴を保存する。updated_at が前回と同じ車両は主キー（vehicle_id, updated_at）の重複で入らない。
 * 保存した件数を返す。
 */
export async function insertVehiclePositions(
  tx: DbTx,
  vehicles: readonly Vehicle[],
  polledAt: Date,
): Promise<number> {
  if (vehicles.length === 0) return 0;
  const result = await tx.vehiclePosition.createMany({
    data: vehicles.map((v) => ({
      vehicleId: v.vehicleId,
      updatedAt: v.updatedAt,
      polledAt,
      routeId: v.routeId,
      tripId: v.tripId,
      directionId: v.directionId,
      lat: v.lat,
      lon: v.lon,
      bearing: v.bearing,
      currentStatus: v.currentStatus,
      stopId: v.stopId,
      currentStopSequence: v.currentStopSequence,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * 到着イベントを保存する。同じ（運行日, 便, 親駅）が既にあれば入れない（最初に記録した到着を残す）。
 * 保存した件数を返す。
 */
export async function insertArrivalEvents(
  tx: DbTx,
  events: readonly ArrivalEventRow[],
): Promise<number> {
  if (events.length === 0) return 0;
  const result = await tx.arrivalEvent.createMany({
    data: events.map((e) => ({
      serviceDate: serviceDateToDbDate(e.serviceDate),
      tripId: e.tripId,
      stopId: e.stopId,
      routeId: e.routeId,
      directionId: e.directionId,
      vehicleId: e.vehicleId,
      arrivedAt: e.arrivedAt,
      source: e.source,
      precisionSec: e.precisionSec,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * 予測サンプルを保存する。同じ（運行日, 便, 親駅, バケット）が既にあれば入れない（各バケットで最初の観測を残す）。
 * 保存した件数を返す。
 */
export async function insertPredictionSamples(
  tx: DbTx,
  samples: readonly PredictionSampleRow[],
): Promise<number> {
  if (samples.length === 0) return 0;
  const result = await tx.predictionSample.createMany({
    data: samples.map((s) => ({
      serviceDate: serviceDateToDbDate(s.serviceDate),
      tripId: s.tripId,
      stopId: s.stopId,
      leadBucketMin: s.leadBucketMin,
      routeId: s.routeId,
      directionId: s.directionId,
      updateType: s.updateType,
      uncertaintySec: s.uncertaintySec,
      predictedArrivalAt: s.predictedArrivalAt,
      observedAt: s.observedAt,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
