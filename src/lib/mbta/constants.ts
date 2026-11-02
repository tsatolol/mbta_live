// MBTA の定数。路線 ID の一覧などはここに一元化する。

/** 対象の 8 路線（Rapid Transit） */
export const TARGET_ROUTE_IDS = [
  "Red",
  "Mattapan",
  "Orange",
  "Blue",
  "Green-B",
  "Green-C",
  "Green-D",
  "Green-E",
] as const;

export type TargetRouteId = (typeof TARGET_ROUTE_IDS)[number];

export function isTargetRouteId(value: string): value is TargetRouteId {
  return (TARGET_ROUTE_IDS as readonly string[]).includes(value);
}

/** route_type: 0 = Light Rail（Green 各支線, Mattapan）、1 = Heavy Rail（Red, Orange, Blue） */
export const ROUTE_TYPE_LIGHT_RAIL = 0;
export const ROUTE_TYPE_HEAVY_RAIL = 1;
export const TARGET_ROUTE_TYPES = [ROUTE_TYPE_LIGHT_RAIL, ROUTE_TYPE_HEAVY_RAIL] as const;

export const DEFAULT_MBTA_API_BASE_URL = "https://api-v3.mbta.com";
