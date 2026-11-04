// 003 T011: 分析のテスト用データ。決まった規則で、運行日ごとの到着イベントと予測サンプルを作る
// （乱数を使わないので、何度作っても同じ）。結合テストと E2E のシードで共有する。
//
// 規則（運行日ごと。時刻は ET）:
// - Red 方向 0: ANALYTICS_SEED.redStations を、05:30 から 00:30 まで 6 分ごと（便ごとに 0〜40 秒ずらす）。
//   駅の間は 2 分。08:00 台に団子運転（前の便の 90 秒後にもう 1 本）、14:00 台に間隔の開き（2 本を抜く = 18 分）
// - Green の 4 支線の方向 0: 幹線の ANALYTICS_SEED.greenTrunkStations を、各支線 12 分ごと（支線ごとに 3 分ずらす）。
//   支線を合算すると 3 分ごと
// - 到着の 10 本に 1 本は補間（interpolated）
// - 予測サンプル: 到着ごとに 5 つのリード時間。誤差は「リード時間（分）× 10 秒」で、便ごとに符号を変える
//   （正 = 予測より遅く到着）。予測の種類は 4 本に 1 本が AT_TERMINAL、ほかは MID_TRIP
import { ensurePartitions } from "@/lib/db/partitions";
import type { ArrivalEventRow } from "@/lib/metrics/arrivals";
import { LEAD_BUCKETS_MIN } from "@/lib/metrics/constants";
import type { PredictionSampleRow } from "@/lib/metrics/sampling";
import { addServiceDays, serviceDayRange, type ServiceDate } from "@/lib/time";
import type { Db } from "@/lib/db/client";

export const ANALYTICS_SEED = {
  redStations: ["place-alfcl", "place-davis", "place-portr", "place-harsq"],
  greenBranches: ["Green-B", "Green-C", "Green-D", "Green-E"],
  greenTrunkStations: ["place-pktrm", "place-boyls"],
  /** 運行日の始まり（03:00 ET）から最初の便まで（分）: 05:30 */
  firstTripMin: 150,
  /** 最後の便（分）: 00:30 */
  lastTripMin: 21 * 60 + 30,
  redHeadwayMin: 6,
  greenBranchHeadwayMin: 12,
  /** 団子運転を入れる時刻（運行日の始まりからの分）: 08:00 台 */
  bunchingAtMin: 5 * 60,
  /** 間隔の開きを入れる時刻: 14:00 台（この時刻から 2 本を抜く） */
  gapAtMin: 11 * 60,
} as const;

export interface AnalyticsSeed {
  arrivals: ArrivalEventRow[];
  samples: PredictionSampleRow[];
}

const MIN = 60_000;

/** 便ごとのずれ（0〜40 秒）。決まった規則で */
function jitterSec(n: number): number {
  return (n * 7) % 41;
}

function addArrival(
  out: AnalyticsSeed,
  serviceDate: ServiceDate,
  routeId: string,
  tripNo: number,
  stopId: string,
  arrivedAt: Date,
  until: Date | undefined,
): void {
  if (until && arrivedAt.getTime() > until.getTime()) return;
  const tripId = `${routeId}-${serviceDate}-${tripNo}`;
  const interpolated = tripNo % 10 === 9;
  out.arrivals.push({
    serviceDate,
    tripId,
    stopId,
    routeId,
    directionId: 0,
    vehicleId: `${routeId}-v${tripNo % 20}`,
    arrivedAt,
    source: interpolated ? "interpolated" : "stopped_at",
    precisionSec: 60,
  });
  for (const lead of LEAD_BUCKETS_MIN) {
    const sign = tripNo % 2 === 0 ? 1 : -1;
    const errorSec = sign * lead * 10;
    const observedAt = new Date(arrivedAt.getTime() - lead * MIN);
    // 予測を観測した時刻が until より後のものは、まだない
    if (until && observedAt.getTime() > until.getTime()) continue;
    out.samples.push({
      serviceDate,
      tripId,
      stopId,
      leadBucketMin: lead,
      routeId,
      directionId: 0,
      updateType: tripNo % 4 === 0 ? "AT_TERMINAL" : "MID_TRIP",
      uncertaintySec: 60,
      // 誤差 = 実到着 − 予測 なので、予測 = 実到着 − 誤差
      predictedArrivalAt: new Date(arrivedAt.getTime() - errorSec * 1000),
      observedAt,
    });
  }
}

/** 1 つの運行日のデータ。until を渡すと、その時刻より後の到着と予測は作らない（今日の途中まで） */
export function analyticsSeedForDay(serviceDate: ServiceDate, until?: Date): AnalyticsSeed {
  const out: AnalyticsSeed = { arrivals: [], samples: [] };
  const start = serviceDayRange(serviceDate).start.getTime();
  const s = ANALYTICS_SEED;

  // Red
  let tripNo = 0;
  for (let m = s.firstTripMin; m <= s.lastTripMin; m += s.redHeadwayMin) {
    // 間隔の開き: この時刻から 2 本を抜く
    if (m >= s.gapAtMin && m < s.gapAtMin + 2 * s.redHeadwayMin) continue;
    const departs = [start + m * MIN + jitterSec(tripNo) * 1000];
    // 団子運転: 前の便の 90 秒後にもう 1 本
    if (m === s.bunchingAtMin) departs.push(departs[0]! + 90_000);
    for (const t of departs) {
      s.redStations.forEach((stopId, i) => {
        addArrival(out, serviceDate, "Red", tripNo, stopId, new Date(t + i * 2 * MIN), until);
      });
      tripNo += 1;
    }
  }

  // Green の 4 支線（幹線の駅）
  s.greenBranches.forEach((routeId, b) => {
    let n = 0;
    for (let m = s.firstTripMin + b * 3; m <= s.lastTripMin; m += s.greenBranchHeadwayMin) {
      const t = start + m * MIN + jitterSec(n + b) * 1000;
      s.greenTrunkStations.forEach((stopId, i) => {
        addArrival(out, serviceDate, routeId, n, stopId, new Date(t + i * 2 * MIN), until);
      });
      n += 1;
    }
  });
  return out;
}

/**
 * 運行日 from〜to（両端を含む）の分を、パーティションを作ってから入れる。
 * 行数が多い（1 日に到着 約 1,500 件・予測 約 7,600 件）ので、Prisma の createMany ではなく 1 本の SQL で入れる
 */
export async function insertAnalyticsSeed(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  until?: Date,
): Promise<{ arrivals: number; samples: number }> {
  const dates: ServiceDate[] = [];
  for (let d = from; d <= to; d = addServiceDays(d, 1)) dates.push(d);
  await ensurePartitions(db, dates);
  let arrivals = 0;
  let samples = 0;
  for (const d of dates) {
    const seed = analyticsSeedForDay(d, until);
    arrivals += await db.$executeRaw`
      INSERT INTO "arrival_events" ("service_date", "trip_id", "stop_id", "route_id", "direction_id",
        "vehicle_id", "arrived_at", "source", "precision_sec")
      SELECT x."service_date", x."trip_id", x."stop_id", x."route_id", x."direction_id",
        x."vehicle_id", x."arrived_at", x."source", x."precision_sec"
      FROM jsonb_to_recordset(${JSON.stringify(
        seed.arrivals.map((a) => ({
          service_date: a.serviceDate,
          trip_id: a.tripId,
          stop_id: a.stopId,
          route_id: a.routeId,
          direction_id: a.directionId,
          vehicle_id: a.vehicleId,
          arrived_at: a.arrivedAt.toISOString(),
          source: a.source,
          precision_sec: a.precisionSec,
        })),
      )}::jsonb) AS x("service_date" date, "trip_id" text, "stop_id" text, "route_id" text,
        "direction_id" integer, "vehicle_id" text, "arrived_at" timestamptz, "source" text,
        "precision_sec" integer)
      ON CONFLICT DO NOTHING`;
    samples += await db.$executeRaw`
      INSERT INTO "prediction_samples" ("service_date", "trip_id", "stop_id", "lead_bucket_min",
        "route_id", "direction_id", "update_type", "uncertainty_sec", "predicted_arrival_at", "observed_at")
      SELECT x."service_date", x."trip_id", x."stop_id", x."lead_bucket_min", x."route_id",
        x."direction_id", x."update_type", x."uncertainty_sec", x."predicted_arrival_at", x."observed_at"
      FROM jsonb_to_recordset(${JSON.stringify(
        seed.samples.map((p) => ({
          service_date: p.serviceDate,
          trip_id: p.tripId,
          stop_id: p.stopId,
          lead_bucket_min: p.leadBucketMin,
          route_id: p.routeId,
          direction_id: p.directionId,
          update_type: p.updateType,
          uncertainty_sec: p.uncertaintySec,
          predicted_arrival_at: p.predictedArrivalAt.toISOString(),
          observed_at: p.observedAt.toISOString(),
        })),
      )}::jsonb) AS x("service_date" date, "trip_id" text, "stop_id" text, "lead_bucket_min" smallint,
        "route_id" text, "direction_id" integer, "update_type" text, "uncertainty_sec" integer,
        "predicted_arrival_at" timestamptz, "observed_at" timestamptz)
      ON CONFLICT DO NOTHING`;
  }
  return { arrivals, samples };
}

/** テスト用のアラート（insertAnalyticsAlerts が入れるもの） */
export const ANALYTICS_SEED_ALERTS = {
  /** Red の遅延: 毎日 08:00〜09:00 ET（60 分） */
  redDelay: "seed-red-delay",
  /** Orange のお知らせ: 期間の初めからずっと（終わりなし） */
  orangeNotice: "seed-orange-notice",
  /** Blue のシャトル: from の 2 日後の 12:00〜16:00 ET だけ（240 分）。フィードから消えた */
  blueShuttle: "seed-blue-shuttle",
  /** Green-B・Green-C の運休: まだ始まっていない（予告だけなので数えない） */
  greenSuspension: "seed-green-suspension",
} as const;

/**
 * テスト用のアラートを入れる。from の運行日の始まりから now まで観測していたことにする
 * （青のシャトルだけは、その日のうちにフィードから消えた）
 */
export async function insertAnalyticsAlerts(
  db: Db,
  from: ServiceDate,
  to: ServiceDate,
  now: Date,
): Promise<void> {
  const firstSeenAt = serviceDayRange(from).start;
  const etHour = (d: ServiceDate, hour: number) =>
    new Date(serviceDayRange(d).start.getTime() + (hour - 3) * 3_600_000);
  const dates: ServiceDate[] = [];
  for (let d = from; d <= to; d = addServiceDays(d, 1)) dates.push(d);
  const shuttleDay = addServiceDays(from, 2);
  const alerts = [
    {
      id: ANALYTICS_SEED_ALERTS.redDelay,
      effect: "DELAY",
      cause: "SIGNAL_PROBLEM",
      routes: ["Red"],
      periods: dates.map((d) => ({ start: etHour(d, 8), end: etHour(d, 9) })),
      lastSeenAt: now,
      inFeed: true,
    },
    {
      id: ANALYTICS_SEED_ALERTS.orangeNotice,
      effect: "STATION_ISSUE",
      cause: "CONSTRUCTION",
      routes: ["Orange"],
      periods: [{ start: new Date(firstSeenAt.getTime() - 86_400_000), end: null }],
      lastSeenAt: now,
      inFeed: true,
    },
    {
      id: ANALYTICS_SEED_ALERTS.blueShuttle,
      effect: "SHUTTLE",
      cause: "MAINTENANCE",
      routes: ["Blue"],
      periods: [{ start: etHour(shuttleDay, 12), end: etHour(shuttleDay, 16) }],
      lastSeenAt: etHour(shuttleDay, 16),
      inFeed: false,
    },
    {
      id: ANALYTICS_SEED_ALERTS.greenSuspension,
      effect: "SUSPENSION",
      cause: "CONSTRUCTION",
      routes: ["Green-B", "Green-C"],
      periods: [{ start: new Date(now.getTime() + 3 * 86_400_000), end: null }],
      lastSeenAt: now,
      inFeed: true,
    },
  ];
  for (const a of alerts) {
    await db.alert.create({
      data: {
        id: a.id,
        effect: a.effect,
        cause: a.cause,
        severity: 5,
        header: `${a.effect} on ${a.routes.join(", ")} (test data)`,
        lifecycle: "ONGOING",
        activePeriod: a.periods.map((p) => ({
          start: p.start.toISOString(),
          end: p.end?.toISOString() ?? null,
        })),
        informedEntity: a.routes.map((route) => ({ route, route_type: 1 })),
        firstSeenAt,
        lastSeenAt: a.lastSeenAt,
        inFeed: a.inFeed,
      },
    });
    await db.alertRoute.createMany({
      data: a.routes.map((routeId) => ({ alertId: a.id, routeId })),
    });
  }
}
