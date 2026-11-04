// E2E 用の DB を用意する（002 T003）。tsx で実行する（pnpm e2e:seed、または tests/e2e/helpers/seed.ts から）:
//   tsx --conditions=react-server tests/e2e/seed-db.ts [--migrate] <シナリオ>
//
// 方式: 001 のフィクスチャ（平日 10:20 ET の記録）を、本番と同じ collector の処理（runCollect）で取り込み、
// そのあと時刻（車両・予測・アラート・collector_runs）を「今」に合わせてずらす。アプリの時計は偽装しない。
// ずらしたあと、画面の状態を確かめるための行（更新の止まった車両、運休・通過の便など）を作る。
//
// シナリオ:
//   base              通常の状態（各 E2E の前提）
//   stale-collection  base に加えて、最後の収集の成功を 4 分前にする（stale バナー）
//   out-of-service    base に加えて、車両と予測を空にする（運行時間外）
//   analytics         base に加えて、分析のテスト用データ（前の 7 日と今日の今まで）を入れ、前の 7 日を aggregate ジョブで集計する
import { z } from "zod";
import { fixedClock } from "@/lib/clock";
import { createDb, type Db } from "@/lib/db/client";
import { createMbtaClient } from "@/lib/mbta/client";
import { runAggregate } from "@/jobs/aggregate";
import { runCollect } from "@/jobs/collect";
import { addServiceDays, serviceDateOf } from "@/lib/time";
import { insertAnalyticsAlerts, insertAnalyticsSeed } from "../helpers/analytics-seed";
import { resetData } from "../helpers/db";
import { recreateDatabase } from "../helpers/migrate-db";
import { fakeMbtaFetch } from "../helpers/fake-mbta";
import { readFixture, WEEKDAY } from "../helpers/fixtures";
import { seedStaticFromFixtures } from "../helpers/seed";
import { E2E_FIXTURES, e2eDatabaseUrl, type E2eScenario } from "./helpers/scenario";

const activePeriodSchema = z.array(z.object({ start: z.string(), end: z.string().nullable() }));

function shiftIso(value: string, deltaMs: number): string {
  return new Date(Date.parse(value) + deltaMs).toISOString();
}

/** フィクスチャの時刻を「今」に合わせてずらす */
async function shiftTimes(db: Db, deltaMs: number): Promise<void> {
  const sec = deltaMs / 1000;
  await db.$executeRaw`UPDATE "vehicles_current" SET
    "updated_at" = "updated_at" + make_interval(secs => ${sec}),
    "polled_at" = "polled_at" + make_interval(secs => ${sec})`;
  await db.$executeRaw`UPDATE "predictions_current" SET
    "arrival_time" = "arrival_time" + make_interval(secs => ${sec}),
    "departure_time" = "departure_time" + make_interval(secs => ${sec}),
    "polled_at" = "polled_at" + make_interval(secs => ${sec})`;
  await db.$executeRaw`UPDATE "collector_runs" SET
    "started_at" = "started_at" + make_interval(secs => ${sec}),
    "finished_at" = "finished_at" + make_interval(secs => ${sec})`;
  await db.$executeRaw`UPDATE "alerts" SET
    "created_at" = "created_at" + make_interval(secs => ${sec}),
    "updated_at" = "updated_at" + make_interval(secs => ${sec}),
    "first_seen_at" = "first_seen_at" + make_interval(secs => ${sec}),
    "last_seen_at" = "last_seen_at" + make_interval(secs => ${sec})`;
  const alerts = await db.alert.findMany({ select: { id: true, activePeriod: true } });
  for (const alert of alerts) {
    const periods = activePeriodSchema.parse(alert.activePeriod).map((p) => ({
      start: shiftIso(p.start, deltaMs),
      end: p.end === null ? null : shiftIso(p.end, deltaMs),
    }));
    await db.alert.update({ where: { id: alert.id }, data: { activePeriod: periods } });
  }
}

/** 画面の状態を確かめるための行を作る（どの行かは E2E_FIXTURES に決めておく） */
async function markFixtures(db: Db, now: Date): Promise<void> {
  // 更新の止まった車両（地図で灰色）
  const stale = await db.vehicleCurrent.findFirst({ orderBy: { vehicleId: "asc" } });
  if (!stale) throw new Error("フィクスチャに車両がありません");
  await db.vehicleCurrent.update({
    where: { vehicleId: stale.vehicleId },
    data: { updatedAt: new Date(now.getTime() - 5 * 60_000) },
  });

  // 運休（Cancelled と表示）と通過（表示しない）の便。E2E_FIXTURES.station のホームの、これから来る便から選ぶ
  const platforms = await db.stop.findMany({
    where: { parentStationId: E2E_FIXTURES.station },
    select: { id: true },
  });
  const upcoming = await db.predictionCurrent.findMany({
    where: {
      stopId: { in: platforms.map((p) => p.id) },
      OR: [{ arrivalTime: { gt: now } }, { departureTime: { gt: now } }],
    },
    orderBy: [{ arrivalTime: "asc" }, { id: "asc" }],
  });
  const [cancelled, skipped] = upcoming;
  if (!cancelled || !skipped) {
    throw new Error(`${E2E_FIXTURES.station} にこれから来る便が 2 本以上ありません`);
  }
  await db.predictionCurrent.update({
    where: { id: cancelled.id },
    data: { scheduleRelationship: "CANCELLED" },
  });
  await db.predictionCurrent.update({
    where: { id: skipped.id },
    data: { scheduleRelationship: "SKIPPED" },
  });

  // フィードから消えた過去のアラート（アラートの画面の検索）。3 日前に 2 時間だけ出ていた
  const start = new Date(now.getTime() - 3 * 24 * 3600_000);
  const lastSeen = new Date(start.getTime() + 2 * 3600_000);
  await db.alert.create({
    data: {
      id: E2E_FIXTURES.pastAlert.id,
      effect: "DELAY",
      cause: "DISABLED_TRAIN",
      severity: 5,
      header: E2E_FIXTURES.pastAlert.header,
      lifecycle: "NEW",
      activePeriod: [{ start: start.toISOString(), end: null }],
      informedEntity: [{ route: "Red", route_type: 1 }],
      createdAt: start,
      updatedAt: start,
      firstSeenAt: start,
      lastSeenAt: lastSeen,
      inFeed: false,
    },
  });
  await db.alertRoute.create({ data: { alertId: E2E_FIXTURES.pastAlert.id, routeId: "Red" } });
}

async function seed(db: Db, scenario: E2eScenario): Promise<void> {
  const now = new Date();
  await resetData(db);
  await seedStaticFromFixtures(db);
  const fetch = fakeMbtaFetch({
    bodies: {
      vehicles: await readFixture(WEEKDAY.vehicles),
      predictions: await readFixture(WEEKDAY.predictions),
      alerts: await readFixture(WEEKDAY.alerts),
    },
  });
  const result = await runCollect({
    db,
    client: createMbtaClient({ fetch }),
    clock: fixedClock(WEEKDAY.recordedAt),
    connectionString: e2eDatabaseUrl(),
  });
  if (result.status !== "success") throw new Error(`collector が失敗しました: ${result.status}`);
  await shiftTimes(db, now.getTime() - WEEKDAY.recordedAt.getTime());
  await markFixtures(db, now);

  if (scenario === "stale-collection") {
    const at = new Date(now.getTime() - 4 * 60_000);
    await db.collectorRun.updateMany({
      where: { job: "collect" },
      data: { startedAt: at, finishedAt: at },
    });
  }
  if (scenario === "out-of-service") {
    await db.vehicleCurrent.deleteMany();
    await db.predictionCurrent.deleteMany();
  }
  if (scenario === "analytics") {
    const today = serviceDateOf(now);
    const from = addServiceDays(today, -ANALYTICS_DAYS);
    await insertAnalyticsSeed(db, from, today, now);
    await insertAnalyticsAlerts(db, from, today, now);
    const result = await runAggregate({
      db,
      clock: fixedClock(now),
      connectionString: e2eDatabaseUrl(),
      retentionDays: 28,
      range: { from, to: addServiceDays(today, -1) },
    });
    if (result.status !== "success") throw new Error(`aggregate が失敗しました: ${result.status}`);
  }
}

/** analytics シナリオで集計する、今日より前の日数 */
const ANALYTICS_DAYS = 7;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scenario = (args.find((a) => !a.startsWith("--")) ?? "base") as E2eScenario;
  if (!["base", "stale-collection", "out-of-service", "analytics"].includes(scenario)) {
    throw new Error(`不明なシナリオです: ${scenario}`);
  }
  const url = e2eDatabaseUrl();
  if (args.includes("--migrate")) await recreateDatabase(url);
  const db = createDb(url);
  try {
    await seed(db, scenario);
  } finally {
    await db.$disconnect();
  }
}

await main();
