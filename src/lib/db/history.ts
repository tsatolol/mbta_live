// 履歴テーブル（生データ）への書き込み
import type { Vehicle } from "@/lib/mbta/schemas/vehicle";
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
