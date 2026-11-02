// /stops の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/stops」）
import { z } from "zod";
import { parseDocument, type RejectedRow } from "../jsonapi";
import { relationId } from "./common";

export const stopRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("stop"),
    attributes: z.object({
      name: z.string(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      location_type: z.number().int(),
      platform_name: z.string().nullable().optional(),
      vehicle_type: z.number().int().nullable().optional(),
    }),
    relationships: z.object({ parent_station: relationId }).optional(),
  })
  .transform(({ id, attributes: a, relationships: r }) => ({
    id,
    name: a.name,
    lat: a.latitude,
    lon: a.longitude,
    locationType: a.location_type,
    parentStationId: r?.parent_station ?? null,
    platformName: a.platform_name ?? null,
    vehicleType: a.vehicle_type ?? null,
  }));

export type Stop = z.output<typeof stopRowSchema>;

export interface StopDocument {
  data: Stop[];
  /** included のうち stop の行（include=parent_station / child_stops で付く） */
  included: Stop[];
  rejected: RejectedRow[];
}

/** /stops の文書を解析する。included の stop も解析する（合わない行は rejected に入れる） */
export function parseStopDocument(body: unknown): StopDocument {
  const parsed = parseDocument(body, stopRowSchema);
  const included: Stop[] = [];
  const rejected = [...parsed.rejected];
  parsed.included.forEach((row, index) => {
    const isStop = typeof row === "object" && row !== null && "type" in row && row.type === "stop";
    if (!isStop) return;
    const result = stopRowSchema.safeParse(row);
    if (result.success) included.push(result.data);
    else
      rejected.push({
        index,
        id: null,
        message: `included: ${result.error.issues[0]?.message ?? ""}`,
      });
  });
  return { data: parsed.rows, included, rejected };
}

/** 地下鉄（vehicle_type 0 = Light Rail、1 = Heavy Rail）のホームか */
function isRapidTransitPlatform(s: Stop): boolean {
  return s.locationType === 0 && (s.vehicleType === 0 || s.vehicleType === 1);
}

/**
 * ②（親駅を filter[id] で指定し include=child_stops）の文書から、親駅と地下鉄のホームだけを返す。
 * child_stops にはバス停・通勤鉄道・出入口なども含まれるので除く
 */
export function selectRapidTransitStops(doc: StopDocument): Stop[] {
  const parents = doc.data.filter((s) => s.locationType === 1);
  const parentIds = new Set(parents.map((s) => s.id));
  const children = doc.included.filter(
    (s) =>
      isRapidTransitPlatform(s) && s.parentStationId !== null && parentIds.has(s.parentStationId),
  );
  return [...parents, ...children];
}
