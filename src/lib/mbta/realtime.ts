// collector が毎回取得する 3 つのエンドポイント（contracts/mbta-api.md の予算: 1 回 3 リクエスト）
import "server-only";
import type { MbtaClient } from "./client";
import { TARGET_ROUTE_IDS } from "./constants";
import { parseAlerts, type Alert } from "./schemas/alert";
import { parsePredictions, type Prediction } from "./schemas/prediction";
import { parseVehicles, type Vehicle } from "./schemas/vehicle";
import type { RejectedRow } from "./jsonapi";

// fields[...] で必要な属性だけを取る。MBTA は fields で属性を絞ってもリレーションを返す（2026-11-02 に確認）
const VEHICLE_FIELDS = [
  "bearing",
  "carriages",
  "current_status",
  "current_stop_sequence",
  "direction_id",
  "label",
  "latitude",
  "longitude",
  "revenue",
  "speed",
  "updated_at",
];

const PREDICTION_FIELDS = [
  "arrival_time",
  "arrival_uncertainty",
  "departure_time",
  "departure_uncertainty",
  "direction_id",
  "schedule_relationship",
  "status",
  "stop_sequence",
  "update_type",
];

export interface RealtimeSnapshot {
  vehicles: Vehicle[];
  predictions: Prediction[];
  alerts: Alert[];
  rejected: { vehicles: RejectedRow[]; predictions: RejectedRow[]; alerts: RejectedRow[] };
}

/** 車両・予測・アラートを取得して解析する。リクエストは 3 つ。429 などのエラーはそのまま投げる */
export async function fetchRealtime(client: MbtaClient): Promise<RealtimeSnapshot> {
  const routeFilter = { "filter[route]": TARGET_ROUTE_IDS };
  // 順番に取得する（同時に送るとレート制限の消費が一瞬に集中するため）
  const vehiclesRes = await client.get("/vehicles", {
    ...routeFilter,
    "fields[vehicle]": VEHICLE_FIELDS,
  });
  const predictionsRes = await client.get("/predictions", {
    ...routeFilter,
    "fields[prediction]": PREDICTION_FIELDS,
  });
  const alertsRes = await client.get("/alerts", routeFilter);

  const vehicles = parseVehicles(vehiclesRes.body);
  const predictions = parsePredictions(predictionsRes.body);
  const alerts = parseAlerts(alertsRes.body);
  return {
    vehicles: vehicles.rows,
    predictions: predictions.rows,
    alerts: alerts.rows,
    rejected: {
      vehicles: vehicles.rejected,
      predictions: predictions.rejected,
      alerts: alerts.rejected,
    },
  };
}
