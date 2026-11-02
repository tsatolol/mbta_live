// 現在値テーブル（vehicles_current / predictions_current）の入れ替え
import type { Prediction } from "@/lib/mbta/schemas/prediction";
import type { Vehicle } from "@/lib/mbta/schemas/vehicle";
import type { DbTx } from "./types";

/** トランザクションの中で、現在値を今回の取得結果に入れ替える */
export async function replaceCurrent(
  tx: DbTx,
  vehicles: readonly Vehicle[],
  predictions: readonly Prediction[],
  polledAt: Date,
): Promise<void> {
  await tx.vehicleCurrent.deleteMany();
  await tx.predictionCurrent.deleteMany();
  if (vehicles.length > 0) {
    await tx.vehicleCurrent.createMany({
      data: vehicles.map((v) => ({
        vehicleId: v.vehicleId,
        routeId: v.routeId,
        tripId: v.tripId,
        directionId: v.directionId,
        lat: v.lat,
        lon: v.lon,
        bearing: v.bearing,
        currentStatus: v.currentStatus,
        stopId: v.stopId,
        currentStopSequence: v.currentStopSequence,
        label: v.label,
        revenue: v.revenue,
        speed: v.speed,
        carriages: v.carriages ?? undefined,
        updatedAt: v.updatedAt,
        polledAt,
      })),
    });
  }
  if (predictions.length > 0) {
    await tx.predictionCurrent.createMany({
      data: predictions.map((p) => ({
        id: p.id,
        routeId: p.routeId,
        tripId: p.tripId,
        stopId: p.stopId,
        directionId: p.directionId,
        stopSequence: p.stopSequence,
        arrivalTime: p.arrivalTime,
        departureTime: p.departureTime,
        status: p.status,
        scheduleRelationship: p.scheduleRelationship,
        updateType: p.updateType,
        uncertaintySec: p.uncertaintySec,
        vehicleId: p.vehicleId,
        polledAt,
      })),
    });
  }
}
