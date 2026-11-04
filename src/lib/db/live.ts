// リアルタイム画面（002）の内部 API が読むクエリ。DB を読むだけ（Web は読み取り専用。憲章）。
import "server-only";
import type { Db } from "./client";

/** 最後に collector が成功した時刻（collector_runs）。一度もなければ null */
export async function getLastCollectedAt(db: Db): Promise<Date | null> {
  const run = await db.collectorRun.findFirst({
    where: { job: "collect", status: "success" },
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true },
  });
  return run?.finishedAt ?? null;
}

export interface VehicleRow {
  vehicleId: string;
  label: string | null;
  routeId: string;
  tripId: string | null;
  directionId: number | null;
  lat: number;
  lon: number;
  bearing: number | null;
  currentStatus: string;
  stopId: string | null;
  updatedAt: Date;
  routeColor: string;
  destination: string | null;
  stopName: string | null;
}

/** 文字列の配列として保存した JSON 列（direction_destinations など）を読む */
export function jsonStringArray(value: unknown): (string | null)[] {
  return Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : null)) : [];
}

/**
 * 現在の車両（vehicles_current）に、路線の色・行先（direction_destinations）・次の駅の名前（stop_id の親駅）を付ける。
 * routeIds を渡せばその路線だけ。路線の並び順、車両 ID の順で返す
 */
export async function listVehicles(db: Db, routeIds?: readonly string[]): Promise<VehicleRow[]> {
  const [vehicles, routes] = await Promise.all([
    db.vehicleCurrent.findMany({
      where: routeIds ? { routeId: { in: [...routeIds] } } : undefined,
      orderBy: { vehicleId: "asc" },
    }),
    db.route.findMany({
      select: { id: true, color: true, sortOrder: true, directionDestinations: true },
    }),
  ]);
  const routeById = new Map(routes.map((r) => [r.id, r]));

  const stopIds = [...new Set(vehicles.flatMap((v) => (v.stopId ? [v.stopId] : [])))];
  const stops = await db.stop.findMany({
    where: { id: { in: stopIds } },
    select: { id: true, name: true, parentStationId: true },
  });
  const parentIds = [
    ...new Set(stops.flatMap((s) => (s.parentStationId ? [s.parentStationId] : []))),
  ];
  const parents = await db.stop.findMany({
    where: { id: { in: parentIds } },
    select: { id: true, name: true },
  });
  const parentName = new Map(parents.map((p) => [p.id, p.name]));
  const stationName = new Map(
    stops.map((s) => [s.id, (s.parentStationId && parentName.get(s.parentStationId)) || s.name]),
  );

  return vehicles
    .map((v) => {
      const route = routeById.get(v.routeId);
      const destinations = jsonStringArray(route?.directionDestinations);
      return {
        vehicleId: v.vehicleId,
        label: v.label,
        routeId: v.routeId,
        tripId: v.tripId,
        directionId: v.directionId,
        lat: v.lat,
        lon: v.lon,
        bearing: v.bearing,
        currentStatus: v.currentStatus,
        stopId: v.stopId,
        updatedAt: v.updatedAt,
        routeColor: route?.color ?? "888888",
        destination: v.directionId === null ? null : (destinations[v.directionId] ?? null),
        stopName: v.stopId ? (stationName.get(v.stopId) ?? null) : null,
        sortOrder: route?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.vehicleId.localeCompare(b.vehicleId))
    .map(({ sortOrder: _sortOrder, ...row }) => row);
}
