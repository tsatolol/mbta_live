// テスト用に、記録済みのフィクスチャから静的データ（路線・駅・路線パターン）を投入する。
// 本番の同期処理（sync-static、US4）とは独立した簡易版。テストの前提データを用意するためだけに使う。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { latestFixtureFile } from "@/lib/mbta/client";
import { isTargetRouteId } from "@/lib/mbta/constants";

const FIXTURES_DIR = path.join(import.meta.dirname, "../fixtures/mbta");

const ref = z.object({ data: z.object({ id: z.string() }).nullable() }).optional();

const routeSchema = z.object({
  id: z.string(),
  attributes: z.object({
    short_name: z.string(),
    long_name: z.string(),
    type: z.number(),
    color: z.string(),
    text_color: z.string(),
    direction_names: z.array(z.string().nullable()),
    direction_destinations: z.array(z.string().nullable()),
    sort_order: z.number(),
  }),
});

const stopSchema = z.object({
  id: z.string(),
  type: z.literal("stop"),
  attributes: z.object({
    name: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    location_type: z.number(),
    platform_name: z.string().nullable().optional(),
    vehicle_type: z.number().nullable().optional(),
  }),
  relationships: z.object({ parent_station: ref }).optional(),
});

const routePatternSchema = z.object({
  id: z.string(),
  attributes: z.object({
    direction_id: z.number(),
    name: z.string(),
    typicality: z.number(),
    canonical: z.boolean(),
  }),
  relationships: z.object({
    route: z.object({ data: z.object({ id: z.string() }) }),
    representative_trip: z.object({ data: z.object({ id: z.string() }) }),
  }),
});

const tripSchema = z.object({
  id: z.string(),
  type: z.literal("trip"),
  relationships: z.object({
    shape: ref,
    stops: z.object({ data: z.array(z.object({ id: z.string() })) }).optional(),
  }),
});

const shapeSchema = z.object({
  id: z.string(),
  type: z.literal("shape"),
  attributes: z.object({ polyline: z.string() }),
});

const docSchema = z.object({
  data: z.array(z.unknown()),
  included: z.array(z.unknown()).optional(),
});

async function loadFixture(key: string): Promise<z.infer<typeof docSchema>> {
  const file = await latestFixtureFile(FIXTURES_DIR, key);
  return docSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

type StopRow = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  locationType: number;
  parentStationId: string | null;
  platformName: string | null;
  vehicleType: number | null;
};

function toStopRow(raw: unknown): StopRow | null {
  const parsed = stopSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  return {
    id: s.id,
    name: s.attributes.name,
    lat: s.attributes.latitude,
    lon: s.attributes.longitude,
    locationType: s.attributes.location_type,
    parentStationId: s.relationships?.parent_station?.data?.id ?? null,
    platformName: s.attributes.platform_name ?? null,
    vehicleType: s.attributes.vehicle_type ?? null,
  };
}

/** 路線・駅（親駅、ホーム、終点の番線）・路線パターンを投入する。件数を返す */
export async function seedStaticFromFixtures(
  db: Db,
): Promise<{ routes: number; stops: number; routePatterns: number }> {
  const routes = (await loadFixture("routes")).data.map((r) => routeSchema.parse(r));
  await db.route.createMany({
    data: routes.map((r) => ({
      id: r.id,
      shortName: r.attributes.short_name,
      longName: r.attributes.long_name,
      type: r.attributes.type,
      color: r.attributes.color,
      textColor: r.attributes.text_color,
      directionNames: r.attributes.direction_names,
      directionDestinations: r.attributes.direction_destinations,
      sortOrder: r.attributes.sort_order,
    })),
    skipDuplicates: true,
  });

  const stops = new Map<string, StopRow>();
  const routeTypeDoc = await loadFixture("stops-route-type");
  for (const raw of [...routeTypeDoc.data, ...(routeTypeDoc.included ?? [])]) {
    const row = toStopRow(raw);
    if (row) stops.set(row.id, row);
  }
  // 終点の番線など、route_type で絞った結果に含まれないホームを child_stops から補う
  const childDoc = await loadFixture("stops-child-stops");
  for (const parent of childDoc.data) {
    const row = toStopRow(parent);
    if (row) stops.set(row.id, row);
  }
  const parentIds = new Set(childDoc.data.flatMap((p) => toStopRow(p)?.id ?? []));
  for (const raw of childDoc.included ?? []) {
    const row = toStopRow(raw);
    if (!row || row.locationType !== 0 || (row.vehicleType !== 0 && row.vehicleType !== 1))
      continue;
    if (row.parentStationId && parentIds.has(row.parentStationId)) stops.set(row.id, row);
  }
  await db.stop.createMany({ data: [...stops.values()], skipDuplicates: true });

  const patternDoc = await loadFixture("route-patterns");
  const trips = new Map<string, z.infer<typeof tripSchema>>();
  const shapes = new Map<string, string>();
  for (const raw of patternDoc.included ?? []) {
    const trip = tripSchema.safeParse(raw);
    if (trip.success) trips.set(trip.data.id, trip.data);
    const shape = shapeSchema.safeParse(raw);
    if (shape.success) shapes.set(shape.data.id, shape.data.attributes.polyline);
  }
  const patterns = patternDoc.data
    .map((r) => routePatternSchema.parse(r))
    .filter((p) => isTargetRouteId(p.relationships.route.data.id));
  await db.routePattern.createMany({
    data: patterns.map((p) => {
      const trip = trips.get(p.relationships.representative_trip.data.id);
      const platformStopIds = trip?.relationships.stops?.data.map((s) => s.id) ?? [];
      const shapeId = trip?.relationships.shape?.data?.id;
      return {
        id: p.id,
        routeId: p.relationships.route.data.id,
        directionId: p.attributes.direction_id,
        name: p.attributes.name,
        typicality: p.attributes.typicality,
        canonical: p.attributes.canonical,
        shapePolyline: shapeId ? (shapes.get(shapeId) ?? null) : null,
        platformStopIds,
        stationIds: platformStopIds.map((id) => stops.get(id)?.parentStationId ?? id),
      };
    }),
    skipDuplicates: true,
  });

  return { routes: routes.length, stops: stops.size, routePatterns: patterns.length };
}
