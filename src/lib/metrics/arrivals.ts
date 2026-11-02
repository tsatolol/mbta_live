// 実到着の検出（specs/001-data-collection/data-model.md の「到着の検出」）。副作用のない純粋関数
import { serviceDateOf, type ServiceDate } from "@/lib/time";
import { STALE_VEHICLE_SEC } from "./constants";
import type { StopIndex } from "./stop-index";

/** 前回の記録がないときに、到着時刻の精度として使う収集間隔（秒） */
export const DEFAULT_POLL_INTERVAL_SEC = 60;

export type ArrivalSource = "stopped_at" | "predicted_last" | "interpolated";

/** 到着検出に使う車両の情報（vehicles_current の行と、今回取得した車両のどちらでもよい） */
export interface VehicleObservation {
  vehicleId: string;
  routeId: string;
  tripId: string | null;
  directionId: number | null;
  stopId: string | null;
  currentStopSequence: number | null;
  currentStatus: string;
  revenue: string | null;
  updatedAt: Date;
}

/** 到着検出に使う予測の情報（前回の predictions_current の行） */
export interface PredictionObservation {
  tripId: string;
  stopId: string;
  stopSequence: number | null;
  arrivalTime: Date | null;
  departureTime: Date | null;
  scheduleRelationship: string | null;
}

export interface ArrivalEventRow {
  serviceDate: ServiceDate;
  tripId: string;
  /** 親駅 */
  stopId: string;
  routeId: string;
  directionId: number;
  vehicleId: string;
  arrivedAt: Date;
  source: ArrivalSource;
  precisionSec: number;
}

export interface DetectArrivalsInput {
  /** 前回の収集時の車両（今回の入れ替え前の vehicles_current） */
  prevVehicles: readonly VehicleObservation[];
  /** 前回の収集時の予測（今回の入れ替え前の predictions_current） */
  prevPredictions: readonly PredictionObservation[];
  /** 前回の収集時刻（なければ null） */
  prevPolledAt: Date | null;
  /** 今回取得した車両 */
  currVehicles: readonly VehicleObservation[];
  index: StopIndex;
  now: Date;
}

export interface DetectArrivalsResult {
  events: ArrivalEventRow[];
  /** 駅の索引にない stop ID（sync-static で解決する） */
  unknownStopIds: string[];
}

const NOT_SERVED = new Set(["SKIPPED", "CANCELLED"]);

function seconds(ms: number): number {
  return Math.max(0, Math.round(ms / 1000));
}

function clamp(t: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, t));
}

/** 到着検出の対象にする車両か（更新が止まっていない営業中の車両で、便と方向がわかるもの） */
export function isTrackable(
  v: VehicleObservation,
  now: Date,
): v is VehicleObservation & { tripId: string; directionId: number } {
  return (
    v.revenue === "REVENUE" &&
    v.tripId !== null &&
    v.directionId !== null &&
    now.getTime() - v.updatedAt.getTime() < STALE_VEHICLE_SEC * 1000
  );
}

/**
 * 前回と今回の車両・予測を比べて、到着イベントを推定する。
 * 1. 今回 STOPPED_AT の駅 → arrived_at = updated_at（stopped_at）
 * 2. 前回から停車順が進んだ区間の駅 → 前回の予測時刻（predicted_last）、なければ線形補間（interpolated）
 * 同じ便・同じ親駅の到着は 1 件にまとめる。DB には先に記録したものが残る（主キーの重複で後の分は入らない）
 */
export function detectArrivals(input: DetectArrivalsInput): DetectArrivalsResult {
  const { index, now } = input;
  const pollGapSec = input.prevPolledAt
    ? seconds(now.getTime() - input.prevPolledAt.getTime())
    : DEFAULT_POLL_INTERVAL_SEC;
  const prevById = new Map(input.prevVehicles.map((v) => [v.vehicleId, v]));
  const predsByTrip = new Map<string, PredictionObservation[]>();
  for (const p of input.prevPredictions) {
    predsByTrip.set(p.tripId, [...(predsByTrip.get(p.tripId) ?? []), p]);
  }

  const events = new Map<string, ArrivalEventRow>();
  const unknown = new Set<string>();

  function add(e: Omit<ArrivalEventRow, "serviceDate">): void {
    const serviceDate = serviceDateOf(e.arrivedAt);
    const key = `${serviceDate}|${e.tripId}|${e.stopId}`;
    const existing = events.get(key);
    if (!existing || e.arrivedAt < existing.arrivedAt) events.set(key, { ...e, serviceDate });
  }

  function stationOf(stopId: string | null): string | null {
    if (stopId === null) return null;
    const station = index.parentOf(stopId);
    if (station === null) unknown.add(stopId);
    return station;
  }

  for (const curr of input.currVehicles) {
    if (!isTrackable(curr, now)) continue;
    const currStation = stationOf(curr.stopId);
    const base = {
      tripId: curr.tripId,
      routeId: curr.routeId,
      directionId: curr.directionId,
      vehicleId: curr.vehicleId,
    };

    // 2. 前回から進んだ区間（同じ便で、停車順が増えたときだけ）
    const prev = prevById.get(curr.vehicleId);
    if (
      prev &&
      prev.tripId === curr.tripId &&
      prev.currentStopSequence !== null &&
      curr.currentStopSequence !== null &&
      curr.currentStopSequence > prev.currentStopSequence &&
      currStation !== null
    ) {
      const prevStopped = prev.currentStatus === "STOPPED_AT";
      const prevStation = stationOf(prev.stopId);
      const tripPreds = predsByTrip.get(curr.tripId) ?? [];
      const predByStation = new Map<string, PredictionObservation>();
      for (const p of tripPreds) {
        const s = index.parentOf(p.stopId);
        if (s !== null && !predByStation.has(s)) predByStation.set(s, p);
      }

      // 区間の駅: 路線パターンの停車順を使い、見つからなければ前回の予測の停車順を使う
      let passed: string[] | null =
        prevStation === null
          ? null
          : index.stationsBetween(
              curr.routeId,
              curr.directionId,
              prevStation,
              currStation,
              !prevStopped,
            );
      if (passed === null) {
        const lo = prevStopped ? prev.currentStopSequence + 1 : prev.currentStopSequence;
        passed = tripPreds
          .filter(
            (p) =>
              p.stopSequence !== null &&
              p.stopSequence >= lo &&
              p.stopSequence < (curr.currentStopSequence ?? 0),
          )
          .sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0))
          .flatMap((p) => {
            const s = index.parentOf(p.stopId);
            return s === null || s === currStation ? [] : [s];
          });
      }

      const t0 = prev.updatedAt.getTime();
      const t1 = Math.max(t0, curr.updatedAt.getTime());
      let last = t0;
      passed.forEach((station, i) => {
        const pred = predByStation.get(station);
        if (pred && pred.scheduleRelationship !== null && NOT_SERVED.has(pred.scheduleRelationship))
          return; // 通過・運休
        const predicted = pred ? (pred.arrivalTime ?? pred.departureTime) : null;
        let t: number;
        let source: ArrivalSource;
        let precisionSec: number;
        if (predicted) {
          t = clamp(predicted.getTime(), t0, t1);
          source = "predicted_last";
          precisionSec = pollGapSec;
        } else {
          t = t0 + ((i + 1) / (passed.length + 1)) * (t1 - t0);
          source = "interpolated";
          precisionSec = seconds(t1 - t0);
        }
        // 停車順に沿って到着時刻が減らないようにする
        last = Math.max(last, t);
        add({ ...base, stopId: station, arrivedAt: new Date(last), source, precisionSec });
      });
    }

    // 1. 今回停車中の駅
    if (curr.currentStatus === "STOPPED_AT" && currStation !== null) {
      add({
        ...base,
        stopId: currStation,
        arrivedAt: curr.updatedAt,
        source: "stopped_at",
        precisionSec: pollGapSec,
      });
    }
  }

  return { events: [...events.values()], unknownStopIds: [...unknown].sort() };
}
