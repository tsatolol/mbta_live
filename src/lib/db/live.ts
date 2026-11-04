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

export interface StationInfo {
  id: string;
  name: string;
  /** その親駅に属するホーム（location_type 0）の ID */
  platformIds: string[];
}

/** 親駅（location_type 1）と、そのホームの ID。親駅でなければ null */
export async function getStation(db: Db, stationId: string): Promise<StationInfo | null> {
  const station = await db.stop.findFirst({
    where: { id: stationId, locationType: 1 },
    select: { id: true, name: true },
  });
  if (!station) return null;
  const platforms = await db.stop.findMany({
    where: { parentStationId: station.id, locationType: 0 },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return { ...station, platformIds: platforms.map((p) => p.id) };
}

export interface StationDirection {
  routeId: string;
  routeColor: string;
  directionId: number;
  directionName: string | null;
  destination: string | null;
}

/**
 * その駅から出る列車の路線と方向。典型的な路線パターン（canonical か typicality 1）のうち、
 * その駅を通り、かつその駅が終点でないものから決める（終点では、その方向の「次の列車」はない）。
 * 路線の並び順、方向の順で返す
 */
export async function listStationDirections(
  db: Db,
  stationId: string,
): Promise<StationDirection[]> {
  const [patterns, routes] = await Promise.all([
    db.routePattern.findMany({
      where: {
        OR: [{ canonical: true }, { typicality: 1 }],
        stationIds: { array_contains: [stationId] },
      },
      select: { routeId: true, directionId: true, stationIds: true },
    }),
    db.route.findMany({
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, color: true, directionNames: true, directionDestinations: true },
    }),
  ]);
  const keys = new Set(
    patterns
      .filter((p) => {
        const ids = jsonStringArray(p.stationIds);
        return ids.includes(stationId) && ids.at(-1) !== stationId;
      })
      .map((p) => `${p.routeId}:${p.directionId}`),
  );
  return routes.flatMap((r) =>
    [0, 1]
      .filter((d) => keys.has(`${r.id}:${d}`))
      .map((d) => ({
        routeId: r.id,
        routeColor: r.color,
        directionId: d,
        directionName: jsonStringArray(r.directionNames)[d] ?? null,
        destination: jsonStringArray(r.directionDestinations)[d] ?? null,
      })),
  );
}

export interface PredictionRow {
  id: string;
  routeId: string;
  directionId: number;
  tripId: string;
  vehicleId: string | null;
  arrivalTime: Date | null;
  departureTime: Date | null;
  status: string | null;
  scheduleRelationship: string | null;
  uncertaintySec: number | null;
}

/** ホームの予測（predictions_current）。SKIPPED の便は除く */
export async function listPredictionsAtStops(
  db: Db,
  stopIds: readonly string[],
): Promise<PredictionRow[]> {
  return db.predictionCurrent.findMany({
    where: {
      stopId: { in: [...stopIds] },
      OR: [{ scheduleRelationship: null }, { scheduleRelationship: { not: "SKIPPED" } }],
    },
    select: {
      id: true,
      routeId: true,
      directionId: true,
      tripId: true,
      vehicleId: true,
      arrivalTime: true,
      departureTime: true,
      status: true,
      scheduleRelationship: true,
      uncertaintySec: true,
    },
  });
}

export interface AlertRow {
  id: string;
  effect: string;
  cause: string;
  severity: number;
  header: string;
  shortHeader: string | null;
  description: string | null;
  serviceEffect: string | null;
  timeframe: string | null;
  lifecycle: string;
  activePeriod: unknown;
  informedEntity: unknown;
  inFeed: boolean;
  updatedAt: Date | null;
  lastSeenAt: Date;
  routeIds: string[];
}

export interface AlertFilter {
  /** これらの路線のどれかに関係するもの（alert_routes）。省略時はすべて */
  routeIds?: readonly string[];
  /** 今のフィードにあるものだけ */
  inFeedOnly?: boolean;
  /** 影響の種類（effect）のどれか。省略時はすべて */
  effects?: readonly string[];
}

/**
 * アラートを重要度の高い順（同じなら更新の新しい順）に返す。各アラートの路線（routeIds）は路線の並び順。
 * 期間での絞り込みと状態の計算は、呼ぶ側が純粋関数（src/lib/metrics/alerts.ts）で行う
 */
export async function listAlerts(db: Db, filter: AlertFilter = {}): Promise<AlertRow[]> {
  let alertIds: string[] | undefined;
  if (filter.routeIds) {
    if (filter.routeIds.length === 0) return [];
    const links = await db.alertRoute.findMany({
      where: { routeId: { in: [...filter.routeIds] } },
      select: { alertId: true },
    });
    alertIds = [...new Set(links.map((l) => l.alertId))];
  }
  const alerts = await db.alert.findMany({
    where: {
      ...(alertIds ? { id: { in: alertIds } } : {}),
      ...(filter.inFeedOnly ? { inFeed: true } : {}),
      ...(filter.effects ? { effect: { in: [...filter.effects] } } : {}),
    },
    orderBy: [{ severity: "desc" }, { updatedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
  });
  const [allLinks, routes] = await Promise.all([
    db.alertRoute.findMany({ where: { alertId: { in: alerts.map((a) => a.id) } } }),
    db.route.findMany({ select: { id: true, sortOrder: true } }),
  ]);
  const order = new Map(routes.map((r) => [r.id, r.sortOrder]));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  const routesByAlert = new Map<string, string[]>();
  for (const l of allLinks) {
    routesByAlert.set(l.alertId, [...(routesByAlert.get(l.alertId) ?? []), l.routeId]);
  }
  for (const ids of routesByAlert.values()) {
    ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }
  return alerts.map((a) => ({
    id: a.id,
    effect: a.effect,
    cause: a.cause,
    severity: a.severity,
    header: a.header,
    shortHeader: a.shortHeader,
    description: a.description,
    serviceEffect: a.serviceEffect,
    timeframe: a.timeframe,
    lifecycle: a.lifecycle,
    activePeriod: a.activePeriod,
    informedEntity: a.informedEntity,
    inFeed: a.inFeed,
    updatedAt: a.updatedAt,
    lastSeenAt: a.lastSeenAt,
    routeIds: routesByAlert.get(a.id) ?? [],
  }));
}
