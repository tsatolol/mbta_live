// 静的データ（路線・駅・路線パターン）を読むクエリ（002）。書き込みは sync-static（001）だけが行う
import "server-only";
import type { StationPattern } from "@/lib/api-schemas/stops";
import type { Db } from "./client";
import { jsonStringArray } from "./live";

export interface RouteRow {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  textColor: string;
  sortOrder: number;
  directionNames: (string | null)[];
  directionDestinations: (string | null)[];
}

/** 路線を並び順で返す */
export async function listRoutes(db: Db): Promise<RouteRow[]> {
  const routes = await db.route.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return routes.map((r) => ({
    id: r.id,
    shortName: r.shortName,
    longName: r.longName,
    color: r.color,
    textColor: r.textColor,
    sortOrder: r.sortOrder,
    directionNames: jsonStringArray(r.directionNames),
    directionDestinations: jsonStringArray(r.directionDestinations),
  }));
}

export interface RouteShapeRow {
  routePatternId: string;
  routeId: string;
  directionId: number;
  polyline: string;
}

/**
 * 地図に描く路線形状: 路線・方向ごとの canonical な路線パターンの形状。
 * 分岐のある路線（Red の Ashmont と Braintree）は、方向ごとに複数ある
 */
export async function listRouteShapes(db: Db): Promise<RouteShapeRow[]> {
  const patterns = await db.routePattern.findMany({
    where: { canonical: true, shapePolyline: { not: null } },
    orderBy: [{ routeId: "asc" }, { directionId: "asc" }, { id: "asc" }],
    select: { id: true, routeId: true, directionId: true, shapePolyline: true },
  });
  return patterns.flatMap((p) =>
    p.shapePolyline
      ? [
          {
            routePatternId: p.id,
            routeId: p.routeId,
            directionId: p.directionId,
            polyline: p.shapePolyline,
          },
        ]
      : [],
  );
}

export interface StationRow {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
}

export interface RouteStationsRow {
  routeId: string;
  routeName: string;
  routeColor: string;
  stations: StationRow[];
}

/** route_patterns.station_ids（親駅 ID の配列）を読む */
export function stationIdsOf(value: unknown): string[] {
  return jsonStringArray(value).flatMap((id) => (id ? [id] : []));
}

/**
 * 路線ごとの親駅を停車順で返す。方向 0 の canonical な路線パターンの station_ids を順につなぐ
 * （分岐のある路線は、最初のパターンの駅のあとに、ほかのパターンにだけある駅を続ける。
 * Red なら Alewife → … → JFK/UMass → Ashmont 支線 → Braintree 支線）。routeId を渡せばその路線だけ
 */
export async function listRouteStations(db: Db, routeId?: string): Promise<RouteStationsRow[]> {
  const [routes, patterns] = await Promise.all([
    listRoutes(db),
    db.routePattern.findMany({
      where: { canonical: true, directionId: 0, ...(routeId ? { routeId } : {}) },
      orderBy: [{ routeId: "asc" }, { id: "asc" }],
      select: { routeId: true, stationIds: true },
    }),
  ]);
  const orderByRoute = new Map<string, string[]>();
  for (const p of patterns) {
    const order = orderByRoute.get(p.routeId) ?? [];
    for (const id of stationIdsOf(p.stationIds)) if (!order.includes(id)) order.push(id);
    orderByRoute.set(p.routeId, order);
  }
  const allIds = [...new Set([...orderByRoute.values()].flat())];
  const stops = await db.stop.findMany({
    where: { id: { in: allIds }, locationType: 1 },
    select: { id: true, name: true, lat: true, lon: true },
  });
  const stopById = new Map(stops.map((s) => [s.id, s]));
  return routes
    .filter((r) => orderByRoute.has(r.id))
    .map((r) => ({
      routeId: r.id,
      routeName: r.longName,
      routeColor: r.color,
      stations: (orderByRoute.get(r.id) ?? []).flatMap((id) => {
        const s = stopById.get(id);
        return s ? [s] : [];
      }),
    }));
}

/** 005 US4: 分岐の情報を保つ方向 0 の canonical な停車順。 */
export async function listStationPatterns(
  db: Db,
  routes: readonly RouteStationsRow[],
  routeId?: string,
): Promise<StationPattern[]> {
  const patterns = await db.routePattern.findMany({
    where: { canonical: true, directionId: 0, ...(routeId ? { routeId } : {}) },
    orderBy: [{ routeId: "asc" }, { id: "asc" }],
    select: { id: true, routeId: true, stationIds: true },
  });
  const valid = new Map(routes.map((r) => [r.routeId, new Set(r.stations.map((s) => s.id))]));
  return patterns.flatMap((p) => {
    const stationIds = [...new Set(stationIdsOf(p.stationIds))].filter((id) =>
      valid.get(p.routeId)?.has(id),
    );
    return stationIds.length ? [{ routeId: p.routeId, routePatternId: p.id, stationIds }] : [];
  });
}
