// 駅の索引: ホーム → 親駅の対応と、路線パターンごとの停車順（親駅）。到着検出で使う純粋なデータ構造
export interface StopRecord {
  id: string;
  locationType: number;
  parentStationId: string | null;
}

export interface PatternRecord {
  routeId: string;
  directionId: number;
  typicality: number;
  stationIds: readonly string[];
}

export interface StopIndex {
  /** ホーム（または親駅）の ID から親駅の ID を返す。知らない ID なら null */
  parentOf(stopId: string): string | null;
  /**
   * 路線・方向の停車順で、from と to の間にある親駅を返す（to は含まない。includeFrom で from を含める）。
   * from と to をこの順で含む路線パターンがなければ null
   */
  stationsBetween(
    routeId: string,
    directionId: number,
    from: string,
    to: string,
    includeFrom: boolean,
  ): string[] | null;
}

export function createStopIndex(
  stops: readonly StopRecord[],
  patterns: readonly PatternRecord[],
): StopIndex {
  const parent = new Map<string, string>();
  for (const s of stops) {
    if (s.locationType === 1) parent.set(s.id, s.id);
    else if (s.parentStationId) parent.set(s.id, s.parentStationId);
  }
  // 通常運行（typicality が小さい）のパターンを先に探す
  const byRoute = new Map<string, PatternRecord[]>();
  for (const p of [...patterns].sort((a, b) => a.typicality - b.typicality)) {
    const key = `${p.routeId}|${p.directionId}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), p]);
  }
  return {
    parentOf: (stopId) => parent.get(stopId) ?? null,
    stationsBetween(routeId, directionId, from, to, includeFrom) {
      for (const p of byRoute.get(`${routeId}|${directionId}`) ?? []) {
        const i = p.stationIds.indexOf(from);
        const j = p.stationIds.indexOf(to);
        if (i >= 0 && j > i) return p.stationIds.slice(includeFrom ? i : i + 1, j);
      }
      return null;
    },
  };
}
