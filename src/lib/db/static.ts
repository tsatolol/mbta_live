// 静的データ（routes / stops / route_patterns）の upsert。テーブルごとに 1 本の SQL にまとめる
import type { Route } from "@/lib/mbta/schemas/route";
import type { Stop } from "@/lib/mbta/schemas/stop";
import type { StaticRoutePattern } from "@/lib/mbta/static";
import type { DbTx } from "./types";

export async function upsertRoutes(tx: DbTx, routes: readonly Route[]): Promise<void> {
  if (routes.length === 0) return;
  const rows = routes.map((r) => ({
    id: r.id,
    short_name: r.shortName,
    long_name: r.longName,
    type: r.type,
    color: r.color,
    text_color: r.textColor,
    direction_names: r.directionNames,
    direction_destinations: r.directionDestinations,
    sort_order: r.sortOrder,
  }));
  await tx.$executeRaw`
    INSERT INTO "routes" ("id", "short_name", "long_name", "type", "color", "text_color",
      "direction_names", "direction_destinations", "sort_order")
    SELECT x."id", x."short_name", x."long_name", x."type", x."color", x."text_color",
      x."direction_names", x."direction_destinations", x."sort_order"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      "id" text, "short_name" text, "long_name" text, "type" integer, "color" text, "text_color" text,
      "direction_names" jsonb, "direction_destinations" jsonb, "sort_order" integer)
    ON CONFLICT ("id") DO UPDATE SET
      "short_name" = EXCLUDED."short_name", "long_name" = EXCLUDED."long_name", "type" = EXCLUDED."type",
      "color" = EXCLUDED."color", "text_color" = EXCLUDED."text_color",
      "direction_names" = EXCLUDED."direction_names", "direction_destinations" = EXCLUDED."direction_destinations",
      "sort_order" = EXCLUDED."sort_order"`;
}

/** 駅を upsert する。今回の応答にない駅は削除しない（過去のデータが参照しているため） */
export async function upsertStops(tx: DbTx, stops: readonly Stop[]): Promise<void> {
  if (stops.length === 0) return;
  const rows = stops.map((s) => ({
    id: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    location_type: s.locationType,
    parent_station_id: s.parentStationId,
    platform_name: s.platformName,
    vehicle_type: s.vehicleType,
  }));
  await tx.$executeRaw`
    INSERT INTO "stops" ("id", "name", "lat", "lon", "location_type", "parent_station_id", "platform_name", "vehicle_type")
    SELECT x."id", x."name", x."lat", x."lon", x."location_type", x."parent_station_id", x."platform_name", x."vehicle_type"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      "id" text, "name" text, "lat" double precision, "lon" double precision, "location_type" integer,
      "parent_station_id" text, "platform_name" text, "vehicle_type" integer)
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name", "lat" = EXCLUDED."lat", "lon" = EXCLUDED."lon",
      "location_type" = EXCLUDED."location_type", "parent_station_id" = EXCLUDED."parent_station_id",
      "platform_name" = EXCLUDED."platform_name", "vehicle_type" = EXCLUDED."vehicle_type"`;
}

/**
 * 路線パターンを今回の応答で置き換える。
 * 今回の応答にないパターンは削除する（古い停車順を到着検出に使わないため）
 */
export async function replaceRoutePatterns(
  tx: DbTx,
  patterns: readonly StaticRoutePattern[],
): Promise<void> {
  if (patterns.length === 0) return;
  await tx.routePattern.deleteMany({ where: { id: { notIn: patterns.map((p) => p.id) } } });
  const rows = patterns.map((p) => ({
    id: p.id,
    route_id: p.routeId,
    direction_id: p.directionId,
    name: p.name,
    typicality: p.typicality,
    canonical: p.canonical,
    shape_polyline: p.shapePolyline,
    platform_stop_ids: p.platformStopIds,
    station_ids: p.stationIds,
  }));
  await tx.$executeRaw`
    INSERT INTO "route_patterns" ("id", "route_id", "direction_id", "name", "typicality", "canonical",
      "shape_polyline", "platform_stop_ids", "station_ids")
    SELECT x."id", x."route_id", x."direction_id", x."name", x."typicality", x."canonical",
      x."shape_polyline", x."platform_stop_ids", x."station_ids"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      "id" text, "route_id" text, "direction_id" integer, "name" text, "typicality" integer, "canonical" boolean,
      "shape_polyline" text, "platform_stop_ids" jsonb, "station_ids" jsonb)
    ON CONFLICT ("id") DO UPDATE SET
      "route_id" = EXCLUDED."route_id", "direction_id" = EXCLUDED."direction_id", "name" = EXCLUDED."name",
      "typicality" = EXCLUDED."typicality", "canonical" = EXCLUDED."canonical",
      "shape_polyline" = EXCLUDED."shape_polyline", "platform_stop_ids" = EXCLUDED."platform_stop_ids",
      "station_ids" = EXCLUDED."station_ids"`;
}

/** 未知の駅 ID を記録する（既にあれば first_seen_at を保つ） */
export async function recordUnknownStopIds(
  tx: DbTx,
  stopIds: readonly string[],
  seenAt: Date,
): Promise<void> {
  if (stopIds.length === 0) return;
  await tx.unknownStopId.createMany({
    data: stopIds.map((stopId) => ({ stopId, firstSeenAt: seenAt })),
    skipDuplicates: true,
  });
}

/** 見つかった駅 ID を解決済みにする */
export async function markStopIdsResolved(
  tx: DbTx,
  stopIds: readonly string[],
  resolvedAt: Date,
): Promise<void> {
  if (stopIds.length === 0) return;
  await tx.unknownStopId.updateMany({
    where: { stopId: { in: [...stopIds] }, resolvedAt: null },
    data: { resolvedAt },
  });
}
