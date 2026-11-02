// 駅の索引を DB（stops / route_patterns）から読み込む
import { createStopIndex, type StopIndex } from "@/lib/metrics/stop-index";
import type { DbLike } from "./types";

export async function loadStopIndex(db: DbLike): Promise<StopIndex> {
  const [stops, patterns] = await Promise.all([
    db.stop.findMany({ select: { id: true, locationType: true, parentStationId: true } }),
    db.routePattern.findMany({
      select: { routeId: true, directionId: true, typicality: true, stationIds: true },
    }),
  ]);
  return createStopIndex(
    stops,
    patterns.map((p) => ({
      ...p,
      stationIds: Array.isArray(p.stationIds)
        ? p.stationIds.filter((s): s is string => typeof s === "string")
        : [],
    })),
  );
}
