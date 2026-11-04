// 静的データ（路線・駅・路線パターン）を読むクエリ（002）。書き込みは sync-static（001）だけが行う
import "server-only";
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
