// 到着検出のテスト用の架空の路線: 路線 R（方向 0）が親駅 A → B → C → D → E の順に停まる
import type { PredictionObservation, VehicleObservation } from "@/lib/metrics/arrivals";
import { createStopIndex } from "@/lib/metrics/stop-index";

export const STATIONS = ["place-a", "place-b", "place-c", "place-d", "place-e"] as const;
/** 親駅ごとのホーム（a1 … e1）。停車順は 10, 20, … 50 */
export const PLATFORMS = ["a1", "b1", "c1", "d1", "e1"] as const;
export const SEQ = [10, 20, 30, 40, 50] as const;

export const index = createStopIndex(
  [
    ...STATIONS.map((id) => ({ id, locationType: 1, parentStationId: null })),
    ...PLATFORMS.map((id, i) => ({ id, locationType: 0, parentStationId: STATIONS[i] ?? null })),
    // 終点の番線
    { id: "A-01", locationType: 0, parentStationId: "place-a" },
  ],
  [{ routeId: "R", directionId: 0, typicality: 1, stationIds: [...STATIONS] }],
);

export const T0 = new Date("2026-11-02T15:00:00Z");
export const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

export function vehicle(overrides: Partial<VehicleObservation> = {}): VehicleObservation {
  return {
    vehicleId: "v1",
    routeId: "R",
    tripId: "t1",
    directionId: 0,
    stopId: "b1",
    currentStopSequence: 20,
    currentStatus: "STOPPED_AT",
    revenue: "REVENUE",
    updatedAt: T0,
    ...overrides,
  };
}

/** i 番目（0 = A）の駅にいる車両 */
export function vehicleAt(
  i: number,
  status: string,
  updatedAt: Date,
  overrides: Partial<VehicleObservation> = {},
) {
  return vehicle({
    stopId: PLATFORMS[i] ?? null,
    currentStopSequence: SEQ[i] ?? null,
    currentStatus: status,
    updatedAt,
    ...overrides,
  });
}

export function prediction(
  i: number,
  arrivalTime: Date | null,
  overrides: Partial<PredictionObservation> = {},
) {
  return {
    tripId: "t1",
    stopId: PLATFORMS[i] ?? "",
    stopSequence: SEQ[i] ?? null,
    arrivalTime,
    departureTime: arrivalTime,
    scheduleRelationship: null,
    ...overrides,
  } satisfies PredictionObservation;
}
