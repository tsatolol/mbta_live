// 車両の鮮度・表示フィルタとは独立に、対象路線の列車を数える。
export function lineCounts(
  routes: readonly { id: string; sortOrder: number }[],
  vehicles: readonly { routeId: string; isStale?: boolean }[],
): { lines: { id: string; count: number }[]; total: number } {
  const counts = new Map<string, number>();
  for (const vehicle of vehicles)
    counts.set(vehicle.routeId, (counts.get(vehicle.routeId) ?? 0) + 1);
  const lines = [...routes]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map(({ id }) => ({ id, count: counts.get(id) ?? 0 }));
  return { lines, total: lines.reduce((sum, line) => sum + line.count, 0) };
}

/** CSS の路線色を地図と凡例で共有する（MBTA の対象 8 路線）。 */
export function lineColorToken(routeId: string): string {
  if (routeId === "Red" || routeId === "Mattapan") return "--line-red";
  if (routeId === "Orange") return "--line-orange";
  if (routeId.startsWith("Green")) return "--line-green";
  return "--line-blue";
}
