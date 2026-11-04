// 002 TR-001: GET /api/live/alerts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { getAlerts } from "@/lib/api/live-alerts";
import { alertsResponseSchema } from "@/lib/api-schemas/alerts";
import { errorResponseSchema } from "@/lib/api-schemas/common";
import { createTestDb, resetData } from "../../helpers/db";
import { apiRequest, LIVE_RECORDED_AT, seedLive } from "../../helpers/live-seed";

const db = createTestDb();
// 記録（2026-11-02 月曜 10:20 ET）の 1 分後
const now = new Date(LIVE_RECORDED_AT.getTime() + 60_000);
const handler = getAlerts({ db, clock: fixedClock(now) });

async function call(query = "") {
  const res = await handler(apiRequest(`/api/live/alerts${query}`));
  return { res, body: (await res.json()) as unknown };
}

async function ids(query = "") {
  const { res, body } = await call(query);
  expect(res.status).toBe(200);
  return alertsResponseSchema.parse(body).alerts.map((a) => a.id);
}

// フィクスチャのアラート: 有効 9 件、予告 3 件（1039322 SUSPENSION、1039759 SHUTTLE、1039769 DELAY）
const UPCOMING = ["1039322", "1039759", "1039769"];
// フィードから消えた過去のアラート（2026-10-20 の Red の遅延。区間の終わりはなく、最後に見たのは 10-20 18:00 ET）
const PAST = "test-past-delay";

beforeAll(async () => {
  await resetData(db);
  await seedLive(db);
  await db.alert.create({
    data: {
      id: PAST,
      effect: "DELAY",
      cause: "SIGNAL_PROBLEM",
      severity: 5,
      header: "Red Line delays due to a signal problem",
      lifecycle: "NEW",
      activePeriod: [{ start: "2026-10-20T20:00:00.000Z", end: null }],
      informedEntity: [{ route: "Red", route_type: 1 }],
      updatedAt: new Date("2026-10-20T20:00:00Z"),
      firstSeenAt: new Date("2026-10-20T20:00:00Z"),
      lastSeenAt: new Date("2026-10-20T22:00:00Z"),
      inFeed: false,
    },
  });
  await db.alertRoute.create({ data: { alertId: PAST, routeId: "Red" } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("GET /api/live/alerts", () => {
  it("既定では有効なアラートを重要度の高い順に返し、応答が共有のスキーマで解析できる", async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const parsed = alertsResponseSchema.parse(body);
    expect(parsed.truncated).toBe(false);
    expect(parsed.alerts).toHaveLength(9);
    for (const a of parsed.alerts) expect(a.status).toBe("active");
    const severities = parsed.alerts.map((a) => a.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    expect(severities[0]).toBe(7);
  });

  it("status=upcoming は予告のアラートだけ", async () => {
    const { body } = await call("?status=upcoming");
    const alerts = alertsResponseSchema.parse(body).alerts;
    expect(alerts.map((a) => a.id).sort()).toEqual(UPCOMING);
    for (const a of alerts) expect(a.status).toBe("upcoming");
  });

  it("status=all はフィードから消えた過去のアラートも含め、過去のものは past", async () => {
    const { body } = await call("?status=all");
    const alerts = alertsResponseSchema.parse(body).alerts;
    expect(alerts).toHaveLength(13);
    const past = alerts.find((a) => a.id === PAST);
    // 区間に終わりがなくても、フィードから消えていれば past
    expect(past).toMatchObject({ status: "past", inFeed: false, routeIds: ["Red"] });
    // 区間は最後に見た時刻で終わる
    expect(past?.activePeriod).toEqual([
      { start: "2026-10-20T20:00:00.000Z", end: "2026-10-20T22:00:00.000Z" },
    ]);
  });

  it("routes で絞り込める（そのどれかに関係するもの）", async () => {
    const { body } = await call("?routes=Blue,Mattapan");
    const alerts = alertsResponseSchema.parse(body).alerts;
    expect(alerts.length).toBe(0);
    const upcomingBlue = await ids("?status=upcoming&routes=Blue");
    expect(upcomingBlue).toEqual(["1039769"]);
    const green = alertsResponseSchema.parse((await call("?status=all&routes=Green-D")).body);
    for (const a of green.alerts) expect(a.routeIds).toContain("Green-D");
    // 複数の路線のアラートは、路線の並び順で routeIds を持つ
    const suspension = green.alerts.find((a) => a.id === "1039322");
    expect(suspension?.routeIds).toEqual(["Green-B", "Green-C", "Green-D", "Green-E"]);
  });

  it("effects で絞り込める", async () => {
    expect(await ids("?status=all&effects=DELAY")).toEqual([PAST, "1039769"]);
    expect((await ids("?effects=STATION_ISSUE,NOTICE")).length).toBe(6);
  });

  it("from / to は、その期間（運行日）に有効だったものを返す", async () => {
    // 過去のアラートは最後に見た時刻（10-20 18:00 ET）までとして扱う
    expect(await ids("?status=all&routes=Red&effects=DELAY&from=2026-10-20&to=2026-10-20")).toEqual(
      [PAST],
    );
    expect(await ids("?status=all&effects=DELAY&from=2026-10-21&to=2026-10-31")).toEqual([]);
    // 予告の DELAY（運行日 11-14 と 11-15。11-14 03:00 ET 〜 11-16 03:00 ET）と重なる期間
    expect(await ids("?status=all&effects=DELAY&from=2026-11-15")).toEqual(["1039769"]);
    // 区間の終わり（11-16 03:00 ET）は含まない
    expect(await ids("?status=all&effects=DELAY&from=2026-11-16")).toEqual([]);
    expect(await ids("?status=all&effects=DELAY&to=2026-10-25")).toEqual([PAST]);
  });

  it.each([
    "?status=past",
    "?routes=Foo",
    "?effects=delay!",
    "?from=2026-13-01",
    "?to=yesterday",
    "?from=2026-11-02&to=2026-11-01",
  ])("不正な値（%s）で 400", async (query) => {
    const { res, body } = await call(query);
    expect(res.status).toBe(400);
    errorResponseSchema.parse(body);
  });
});
