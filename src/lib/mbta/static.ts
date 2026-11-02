// sync-static が毎日取得する静的データ（contracts/mbta-api.md のリクエスト予算: 1 日 4〜5 リクエスト）
import "server-only";
import { createStopIndex } from "@/lib/metrics/stop-index";
import type { MbtaClient } from "./client";
import { TARGET_ROUTE_IDS, TARGET_ROUTE_TYPES } from "./constants";
import { parseRoutePatterns, type RoutePattern } from "./schemas/route-pattern";
import { parseRoutes, type Route } from "./schemas/route";
import { parseStopDocument, selectRapidTransitStops, type Stop } from "./schemas/stop";

export interface StaticRoutePattern extends RoutePattern {
  /** 停車順の親駅 ID（ホームを親駅に変換したもの。親駅がわからないホームは ID のまま） */
  stationIds: string[];
}

export interface StaticSnapshot {
  routes: Route[];
  /** 親駅と地下鉄のホーム（重複なし） */
  stops: Stop[];
  routePatterns: StaticRoutePattern[];
  /** 未解決だった駅 ID のうち、今回の取得で見つかったもの */
  resolvedStopIds: string[];
  rejectedRows: number;
}

export class EmptyStaticDataError extends Error {
  constructor(what: string) {
    super(
      `MBTA API の応答に ${what} が 1 件もありません。既存のデータを守るため、書き込みを中止します`,
    );
    this.name = "EmptyStaticDataError";
  }
}

/**
 * 静的データを取得する。
 * ① /stops（route_type で絞る）でホームと親駅、② 親駅の child_stops で終点の番線などを補う、
 * 未解決の駅 ID が残っていれば ③ /stops?filter[id]= で取得する
 */
export async function fetchStatic(
  client: MbtaClient,
  unresolvedStopIds: readonly string[],
): Promise<StaticSnapshot> {
  const routeTypes = TARGET_ROUTE_TYPES.join(",");
  const routes = parseRoutes((await client.get("/routes", { "filter[type]": routeTypes })).body);
  const first = parseStopDocument(
    (await client.get("/stops", { "filter[route_type]": routeTypes, include: "parent_station" }))
      .body,
  );
  const parentIds = [
    ...new Set(first.included.filter((s) => s.locationType === 1).map((s) => s.id)),
  ].sort();
  const second = parseStopDocument(
    (await client.get("/stops", { "filter[id]": parentIds, include: "child_stops" })).body,
  );
  const patterns = parseRoutePatterns(
    (
      await client.get("/route_patterns", {
        "filter[route]": TARGET_ROUTE_IDS,
        include: "representative_trip.shape,representative_trip.stops",
        "fields[stop]": "name,parent_station",
      })
    ).body,
  );

  const stops = new Map<string, Stop>();
  for (const s of [...first.included, ...first.data, ...selectRapidTransitStops(second)])
    stops.set(s.id, s);
  let rejectedRows =
    routes.rejected.length +
    first.rejected.length +
    second.rejected.length +
    patterns.rejected.length;

  const remaining = unresolvedStopIds.filter((id) => !stops.has(id));
  if (remaining.length > 0) {
    const third = parseStopDocument(
      (await client.get("/stops", { "filter[id]": remaining, include: "parent_station" })).body,
    );
    for (const s of [...third.included, ...third.data]) stops.set(s.id, s);
    rejectedRows += third.rejected.length;
  }

  if (routes.rows.length === 0) throw new EmptyStaticDataError("対象の路線");
  if (stops.size === 0) throw new EmptyStaticDataError("駅");
  if (patterns.rows.length === 0) throw new EmptyStaticDataError("対象の路線パターン");

  const index = createStopIndex([...stops.values()], []);
  return {
    routes: routes.rows,
    stops: [...stops.values()],
    routePatterns: patterns.rows.map((p) => ({
      ...p,
      stationIds: p.platformStopIds.map((id) => index.parentOf(id) ?? id),
    })),
    resolvedStopIds: unresolvedStopIds.filter((id) => stops.has(id)),
    rejectedRows,
  };
}
