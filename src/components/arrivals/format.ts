// 到着表示の文字列と、取得時点の便の選択（純粋関数）。

/** 2 分以上は分、2 分未満は秒。取得後に時刻を迎えた便は次回取得まで Now。 */
export function countdownLabel(time: Date, now: Date): string {
  const ms = time.getTime() - now.getTime();
  if (ms <= 0) return "Now";
  if (ms >= 120_000) return `${Math.floor(ms / 60_000)} min`;
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** 取得時点で過ぎた便だけを除外する。描画時計で毎秒除外すると Now を表示できない。 */
export function upcomingArrivals<T extends { time: string }>(
  arrivals: readonly T[],
  snapshotAt: Date,
): T[] {
  return arrivals.filter((arrival) => Date.parse(arrival.time) > snapshotAt.getTime());
}

/** 予測 API の対象路線 ID を案内用の名前にする。 */
export function arrivalRouteLabel(routeId: string): string {
  return routeId.startsWith("Green-") ? `Green Line ${routeId.slice(6)}` : `${routeId} Line`;
}

/** 方角と Inbound / Outbound の両方を、bound を重ねず小文字にそろえる。 */
export function arrivalDirectionLabel(name: string): string {
  const direction = name.toLowerCase();
  return direction.endsWith("bound") ? direction : `${direction}bound`;
}

/** 駅名の検索: 大文字・小文字と前後の空白を無視した部分一致。空の検索語はすべてに一致する */
export function matchesStationQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}
