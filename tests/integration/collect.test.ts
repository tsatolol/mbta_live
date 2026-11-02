// TR-006・TR-008 と US1 の受け入れシナリオ: collector の結合テスト
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { listPartitions } from "@/lib/db/partitions";
import { createMbtaClient } from "@/lib/mbta/client";
import { TARGET_ROUTE_IDS } from "@/lib/mbta/constants";
import { runCollect } from "@/jobs/collect";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { fakeMbtaFetch, type FakeMbtaOptions } from "../helpers/fake-mbta";
import { readFixture, SUNDAY, WEEKDAY } from "../helpers/fixtures";

const db = createTestDb();

async function bodiesOf(set: typeof WEEKDAY | typeof SUNDAY): Promise<FakeMbtaOptions["bodies"]> {
  return {
    vehicles: await readFixture(set.vehicles),
    predictions: await readFixture(set.predictions),
    alerts: await readFixture(set.alerts),
  };
}

async function collectWith(options: FakeMbtaOptions, now: Date) {
  const fetch = fakeMbtaFetch(options);
  const client = createMbtaClient({ fetch });
  const result = await runCollect({
    db,
    client,
    clock: fixedClock(now),
    connectionString: testDatabaseUrl(),
  });
  return { result, fetch, client };
}

async function currentCounts() {
  return {
    vehicles: await db.vehicleCurrent.count(),
    predictions: await db.predictionCurrent.count(),
    alertsInFeed: await db.alert.count({ where: { inFeed: true } }),
  };
}

beforeEach(async () => {
  await resetData(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("collector", () => {
  it("現在値テーブルに車両・予測・アラートが入り、実行結果が記録される", async () => {
    const { result } = await collectWith({ bodies: await bodiesOf(WEEKDAY) }, WEEKDAY.recordedAt);
    expect(result).toMatchObject({ status: "success", exitCode: 0 });
    expect(await currentCounts()).toEqual({ vehicles: 106, predictions: 2278, alertsInFeed: 12 });

    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ job: "collect", status: "success", ratelimitRemaining: 17 });
    expect(run.counts).toMatchObject({
      vehicles: 106,
      predictions: 2278,
      alerts: 12,
      rejectedRows: 0,
    });
  });

  it("2 回目は現在値を入れ替える（積み増さない）", async () => {
    await collectWith({ bodies: await bodiesOf(WEEKDAY) }, WEEKDAY.recordedAt);
    await collectWith(
      { bodies: await bodiesOf(SUNDAY) },
      new Date(WEEKDAY.recordedAt.getTime() + 60_000),
    );
    expect(await currentCounts()).toMatchObject({ vehicles: 23, predictions: 416 });
    const polled = await db.vehicleCurrent.findFirstOrThrow();
    expect(polled.polledAt.toISOString()).toBe("2026-11-02T15:21:00.000Z");
  });

  it("運行時間外の応答で現在値が空になり、成功として記録される", async () => {
    await collectWith({ bodies: await bodiesOf(WEEKDAY) }, WEEKDAY.recordedAt);
    const { result } = await collectWith(
      {
        bodies: {
          vehicles: await readFixture("cases/vehicles-off-hours.json"),
          predictions: await readFixture("cases/predictions-off-hours.json"),
          alerts: await readFixture(WEEKDAY.alerts),
        },
      },
      new Date("2026-11-02T08:30:00Z"),
    );
    expect(result.status).toBe("success");
    expect(await currentCounts()).toMatchObject({ vehicles: 0, predictions: 0 });
  });

  it("1 回の収集のリクエストは 3 つで、対象 8 路線で絞る", async () => {
    const { fetch, client } = await collectWith(
      { bodies: await bodiesOf(WEEKDAY) },
      WEEKDAY.recordedAt,
    );
    expect(client.requestCount).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.map((u) => u.pathname).sort()).toEqual(["/alerts", "/predictions", "/vehicles"]);
    for (const u of urls)
      expect(u.searchParams.get("filter[route]")).toBe(TARGET_ROUTE_IDS.join(","));
  });

  it("429 では失敗として記録し、リトライせず、現在値は前の状態のまま", async () => {
    await collectWith({ bodies: await bodiesOf(SUNDAY) }, SUNDAY.recordedAt);
    const before = await currentCounts();
    const { result, fetch } = await collectWith(
      { bodies: await bodiesOf(WEEKDAY), rateLimitOn: "predictions" },
      WEEKDAY.recordedAt,
    );
    expect(result).toMatchObject({ status: "failed", exitCode: 1 });
    expect(fetch.mock.calls.filter(([u]) => u.pathname === "/predictions")).toHaveLength(1);
    expect(await currentCounts()).toEqual(before);
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.ratelimitRemaining).toBe(0);
    expect(run.error).toContain("RateLimitedError");
  });

  it("書き込みの途中で失敗すると、前の状態が残る（トランザクション）", async () => {
    await collectWith({ bodies: await bodiesOf(SUNDAY) }, SUNDAY.recordedAt);
    const before = await currentCounts();
    // 同じ ID の予測が 2 件あると主キーの重複で書き込みが失敗する
    const bodies = await bodiesOf(WEEKDAY);
    const predictions = bodies.predictions as { data: unknown[] };
    bodies.predictions = { ...predictions, data: [...predictions.data, predictions.data[0]] };
    const { result } = await collectWith({ bodies }, WEEKDAY.recordedAt);
    expect(result.status).toBe("failed");
    expect(await currentCounts()).toEqual(before);
  });

  it("前の回が動いている間に起動した回は skipped ですぐ終わる", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const bodies = await bodiesOf(WEEKDAY);
    const first = collectWith({ bodies, waitFor: gate }, WEEKDAY.recordedAt);
    // 1 回目がロックを取って MBTA API の応答を待っている間に 2 回目を起動する
    await new Promise((resolve) => setTimeout(resolve, 300));
    const second = await collectWith({ bodies }, WEEKDAY.recordedAt);
    expect(second.result).toMatchObject({ status: "skipped", exitCode: 0 });
    expect(second.fetch).not.toHaveBeenCalled();
    release();
    expect((await first).result.status).toBe("success");
    expect(await currentCounts()).toMatchObject({ vehicles: 106 });
  });

  it("スキーマに合わない行はスキップして、ジョブは成功する", async () => {
    const { result } = await collectWith(
      {
        bodies: {
          vehicles: await readFixture("cases/vehicles-malformed.json"),
          predictions: await readFixture(SUNDAY.predictions),
          alerts: await readFixture(SUNDAY.alerts),
        },
      },
      SUNDAY.recordedAt,
    );
    expect(result.status).toBe("success");
    expect(await db.vehicleCurrent.count()).toBe(2);
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.counts).toMatchObject({ vehicles: 2, rejectedRows: 2 });
  });
});

describe("アラート", () => {
  it("フィードから消えたアラートは削除せず in_feed=false にし、first_seen_at は最初の値を保つ", async () => {
    await collectWith({ bodies: await bodiesOf(SUNDAY) }, SUNDAY.recordedAt);
    const sundayIds = (await db.alert.findMany({ select: { id: true } })).map((a) => a.id);
    await collectWith({ bodies: await bodiesOf(WEEKDAY) }, WEEKDAY.recordedAt);

    const weekdayIds = new Set(
      ((await readFixture(WEEKDAY.alerts)) as { data: { id: string }[] }).data.map((a) => a.id),
    );
    const gone = sundayIds.filter((id) => !weekdayIds.has(id));
    const kept = sundayIds.filter((id) => weekdayIds.has(id));
    expect(gone.length).toBeGreaterThan(0);
    expect(kept.length).toBeGreaterThan(0);

    for (const id of gone) {
      const a = await db.alert.findUniqueOrThrow({ where: { id } });
      expect(a.inFeed).toBe(false);
      expect(a.lastSeenAt).toEqual(SUNDAY.recordedAt);
    }
    for (const id of kept) {
      const a = await db.alert.findUniqueOrThrow({ where: { id } });
      expect(a.inFeed).toBe(true);
      expect(a.firstSeenAt).toEqual(SUNDAY.recordedAt);
      expect(a.lastSeenAt).toEqual(WEEKDAY.recordedAt);
    }
    expect(await db.alert.count()).toBe(new Set([...sundayIds, ...weekdayIds]).size);
  });

  it("alert_routes は対象 8 路線の route だけ", async () => {
    await collectWith({ bodies: await bodiesOf(SUNDAY) }, SUNDAY.recordedAt);
    const routes = await db.alertRoute.findMany();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(TARGET_ROUTE_IDS).toContain(r.routeId);
  });
});

describe("車両位置の履歴", () => {
  it("運行日のパーティションを作って保存し、updated_at が同じ車両は 2 回目に保存しない", async () => {
    await collectWith({ bodies: await bodiesOf(WEEKDAY) }, WEEKDAY.recordedAt);
    expect(await db.vehiclePosition.count()).toBe(106);
    const parts = (await listPartitions(db)).map((p) => p.name);
    expect(parts).toContain("vehicle_positions_p20261102");
    expect(parts).toContain("vehicle_positions_p20261103");

    const { result } = await collectWith(
      { bodies: await bodiesOf(WEEKDAY) },
      new Date(WEEKDAY.recordedAt.getTime() + 60_000),
    );
    expect(await db.vehiclePosition.count()).toBe(106);
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.counts).toMatchObject({ positionsInserted: 0 });
  });
});
