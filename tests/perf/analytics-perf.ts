// 003 T044（SC-002）: 分析 API の応答時間を、prod と同じくらいの量のデータで測る。
//   pnpm tsx --conditions=react-server tests/perf/analytics-perf.ts
// PERF_DATABASE_URL（既定 postgresql://postgres:postgres@localhost:5432/mbta_live_perf）を作り直し、次を入れる:
// - 集計テーブル 28 日分（運行間隔: 路線パターンの全駅 × 2 方向 × 20 時間帯、予測精度: 8 路線 × 2 方向 ×
//   5 リード時間 × 3 種類 × 20 時間帯、アラート）
// - 今日の生データ（到着 約 4 万件・予測サンプル 約 20 万件。plan.md の規模）
// そのうえで、28 日の範囲（今日を含む）で各 API を 5 回ずつ呼び、中央値と最大を出す。
// Route Handler の中身を直接呼ぶので、HTTP と IAP の時間は含まない（DB と計算の時間）
import { fixedClock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { ensurePartitions } from "@/lib/db/partitions";
import { getAnalyticsAlerts } from "@/lib/api/analytics-alerts";
import { getAnalyticsHeadways } from "@/lib/api/analytics-headways";
import { getAnalyticsHeatmap } from "@/lib/api/analytics-heatmap";
import { getAnalyticsPredictions } from "@/lib/api/analytics-predictions";
import { addServiceDays, serviceDateToDbDate, serviceDayRange } from "@/lib/time";
import { recreateDatabase } from "../helpers/migrate-db";
import { seedStaticFromFixtures } from "../helpers/seed";

const url =
  process.env.PERF_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mbta_live_perf";
/** 2026-11-10（火）17:00 ET */
const NOW = new Date("2026-11-10T22:00:00Z");
const TODAY = "2026-11-10";
const FROM = addServiceDays(TODAY, -27);
const HOURS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0];

async function seed(db: Db): Promise<void> {
  await seedStaticFromFixtures(db);
  const from = serviceDateToDbDate(FROM);
  const to = serviceDateToDbDate(addServiceDays(TODAY, -1));

  // 運行間隔: 路線パターン（方向 0・1）の全駅 + Green の合算（幹線）× 時間帯 × 日
  await db.$executeRaw`
    INSERT INTO "daily_headway_stats"
    SELECT d::date, k."route_id", k."direction_id", k."stop_id", h::smallint,
      10, 360 + random() * 60, 360, 600 + random() * 300, 1200, (random() * 2)::int, (random() * 1)::int
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d,
      (SELECT DISTINCT p."route_id", p."direction_id", s AS "stop_id"
       FROM "route_patterns" p, jsonb_array_elements_text(p."station_ids") s
       WHERE p."canonical"
       UNION
       SELECT 'Green', p."direction_id", s
       FROM "route_patterns" p, jsonb_array_elements_text(p."station_ids") s
       WHERE p."canonical" AND p."route_id" LIKE 'Green-%') k,
      unnest(${HOURS}::int[]) h`;
  // 予測精度
  await db.$executeRaw`
    INSERT INTO "daily_prediction_accuracy"
    SELECT d::date, r."id", dir, lead::smallint, t, h::smallint,
      50, random() * 20 - 10, 40 + random() * 40, 120 + random() * 60, 0.6 + random() * 0.3
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d,
      "routes" r, unnest(ARRAY[0, 1]) dir, unnest(ARRAY[1, 3, 5, 10, 15]) lead,
      unnest(ARRAY['MID_TRIP', 'AT_TERMINAL', 'REVERSE_TRIP']) t, unnest(${HOURS}::int[]) h`;
  // アラート（日次: 路線 × 6 種類、時間帯: 路線 × 時間帯 × 区分）
  await db.$executeRaw`
    INSERT INTO "daily_alert_stats"
    SELECT d::date, r, e, 'UNKNOWN_CAUSE', 1 + (random() * 3)::int, (random() * 600)::int
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d,
      unnest(ARRAY['Red', 'Mattapan', 'Orange', 'Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E', 'All']) r,
      unnest(ARRAY['DELAY', 'SUSPENSION', 'SHUTTLE', 'STATION_CLOSURE', 'NOTICE', 'STATION_ISSUE']) e`;
  await db.$executeRaw`
    INSERT INTO "hourly_alert_minutes"
    SELECT d::date, r, h::smallint, c, (random() * 60)::int
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d,
      unnest(ARRAY['Red', 'Mattapan', 'Orange', 'Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E', 'All']) r,
      unnest(${HOURS}::int[]) h, unnest(ARRAY['disruption', 'notice']) c`;
  await db.$executeRaw`
    INSERT INTO "aggregate_runs"
    SELECT d::date, 'success', now(), 1
    FROM generate_series(${from}::date, ${to}::date, interval '1 day') d`;

  // 今日の生データ: 路線パターンの全駅 × 2 方向 × 125 本（約 4 万件）、到着ごとに 5 つの予測サンプル
  await ensurePartitions(db, [TODAY]);
  const start = serviceDayRange(TODAY).start;
  const today = serviceDateToDbDate(TODAY);
  await db.$executeRaw`
    INSERT INTO "arrival_events"
    SELECT ${today}::date, k."route_id" || '-' || k."direction_id" || '-' || n, k."stop_id", k."route_id", k."direction_id", NULL,
      ${start}::timestamptz + interval '150 minutes' + n * interval '7 minutes'
        + (random() * 60) * interval '1 second',
      CASE WHEN n % 10 = 9 THEN 'interpolated' ELSE 'stopped_at' END, 60
    FROM (SELECT DISTINCT p."route_id", p."direction_id", s AS "stop_id"
          FROM "route_patterns" p, jsonb_array_elements_text(p."station_ids") s
          WHERE p."canonical") k,
      generate_series(0, 124) n
    WHERE ${start}::timestamptz + interval '150 minutes' + n * interval '7 minutes' <= ${NOW}::timestamptz`;
  await db.$executeRaw`
    INSERT INTO "prediction_samples"
    SELECT a."service_date", a."trip_id", a."stop_id", lead::smallint, a."route_id", a."direction_id",
      'MID_TRIP', 60, a."arrived_at" - (random() * 120 - 60) * interval '1 second',
      a."arrived_at" - lead * interval '1 minute'
    FROM "arrival_events" a, unnest(ARRAY[1, 3, 5, 10, 15]) lead
    WHERE a."service_date" = ${today}::date`;
  await db.$executeRawUnsafe("ANALYZE");
}

async function time(name: string, fn: () => Promise<Response>): Promise<void> {
  const ms: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t = performance.now();
    const res = await fn();
    if (res.status !== 200) throw new Error(`${name}: ${res.status} ${await res.text()}`);
    await res.json();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(
    `${name.padEnd(48)} median ${ms[2]!.toFixed(0).padStart(5)} ms   max ${ms[4]!.toFixed(0).padStart(5)} ms`,
  );
}

async function main(): Promise<void> {
  await recreateDatabase(url);
  const db = createDb(url);
  try {
    await seed(db);
    const counts = await db.$queryRaw<{ name: string; n: bigint }[]>`
      SELECT 'daily_headway_stats' AS name, count(*) AS n FROM "daily_headway_stats"
      UNION ALL SELECT 'daily_prediction_accuracy', count(*) FROM "daily_prediction_accuracy"
      UNION ALL SELECT 'arrival_events (today)', count(*) FROM "arrival_events"
      UNION ALL SELECT 'prediction_samples (today)', count(*) FROM "prediction_samples"`;
    for (const c of counts)
      console.log(`${c.name.padEnd(30)} ${Number(c.n).toLocaleString("en-US")} rows`);

    const deps = { db, clock: fixedClock(NOW) };
    const range = `from=${FROM}&to=${TODAY}`;
    const req = (path: string) => new Request(`http://localhost${path}`);
    await time("headways (Red, 28 days)", () =>
      getAnalyticsHeadways(deps)(req(`/api/analytics/headways?route=Red&${range}`)),
    );
    await time("headways (Green, 28 days)", () =>
      getAnalyticsHeadways(deps)(req(`/api/analytics/headways?route=Green&${range}`)),
    );
    await time("predictions (all routes, 28 days)", () =>
      getAnalyticsPredictions(deps)(req(`/api/analytics/predictions?${range}`)),
    );
    await time("alerts (all routes, 28 days)", () =>
      getAnalyticsAlerts(deps)(req(`/api/analytics/alerts?${range}`)),
    );
    for (const metric of ["headway_p90", "prediction_abs_error", "alert_minutes"]) {
      await time(`heatmap (${metric}, all routes, 28 days)`, () =>
        getAnalyticsHeatmap(deps)(req(`/api/analytics/heatmap?metric=${metric}&${range}`)),
      );
    }
  } finally {
    await db.$disconnect();
  }
}

await main();
