// 駅の到着表示（Arrival Board、002 US2）で使う計算。到着の検出（001）は arrivals.ts。純粋関数（現在時刻は引数で受け取る）。
// 定義は specs/002-live-dashboard/contracts/live-api.md の GET /api/live/predictions。

/** 到着表示に出す本数（方向ごと） */
export const ARRIVALS_PER_DIRECTION = 3;

export interface PredictionInput {
  arrivalTime: Date | null;
  departureTime: Date | null;
  scheduleRelationship: string | null;
}

export interface PredictionTime {
  time: Date;
  /** 到着時刻がない（始発駅）ときは出発時刻を使う */
  timeKind: "arrival" | "departure";
}

/** 表示に使う時刻: 到着予定時刻、なければ（始発駅）出発予定時刻。どちらもなければ null */
export function predictionTime(p: PredictionInput): PredictionTime | null {
  if (p.arrivalTime) return { time: p.arrivalTime, timeKind: "arrival" };
  if (p.departureTime) return { time: p.departureTime, timeKind: "departure" };
  return null;
}

/**
 * 方向ごとの次の n 本: SKIPPED（通過）の便、時刻のない便、予定時刻が過ぎた便を除き、時刻の順に n 本。
 * 運休（CANCELLED）の便は時刻があれば残す（表示で Cancelled とする）。
 * MBTA は運休の便の時刻をふつう null で返すので、時刻のない運休の便は並べる場所がなく、除く
 */
export function nextArrivals<T extends PredictionInput>(
  predictions: readonly T[],
  now: Date,
  limit = ARRIVALS_PER_DIRECTION,
): (T & PredictionTime)[] {
  return predictions
    .filter((p) => p.scheduleRelationship !== "SKIPPED")
    .flatMap((p) => {
      const t = predictionTime(p);
      return t && t.time.getTime() > now.getTime() ? [{ ...p, ...t }] : [];
    })
    .sort((a, b) => a.time.getTime() - b.time.getTime())
    .slice(0, limit);
}

export interface InformedEntity {
  route?: string;
  stop?: string;
}

/**
 * アラートがその駅に関係するか: informed_entity のどれかが、駅の路線のどれか（路線の指定がなければどれでも）で、
 * かつ駅（親駅かそのホーム）を指すか、駅を指定していない（路線全体）
 */
export function alertAppliesToStation(
  entities: readonly InformedEntity[],
  station: { routeIds: readonly string[]; stopIds: readonly string[] },
): boolean {
  return entities.some(
    (e) =>
      (e.route === undefined || station.routeIds.includes(e.route)) &&
      (e.stop === undefined || station.stopIds.includes(e.stop)),
  );
}
