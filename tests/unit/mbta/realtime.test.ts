// TR-001 の一部: 車両・予測・アラートの応答の解析
import { describe, expect, it } from "vitest";
import { parseAlerts } from "@/lib/mbta/schemas/alert";
import { parsePredictions } from "@/lib/mbta/schemas/prediction";
import { parseVehicles } from "@/lib/mbta/schemas/vehicle";
import { readFixture, SUNDAY, WEEKDAY } from "../../helpers/fixtures";

describe("parseVehicles", () => {
  it("平日の日中の 106 両をすべて解析できる", async () => {
    const { rows, rejected } = parseVehicles(await readFixture(WEEKDAY.vehicles));
    expect(rows).toHaveLength(106);
    expect(rejected).toEqual([]);
  });

  it("ドメインの値に変換する", async () => {
    const { rows } = parseVehicles(await readFixture(SUNDAY.vehicles));
    const v = rows.find((r) => r.vehicleId === "G-10023");
    expect(v).toMatchObject({
      vehicleId: "G-10023",
      routeId: "Mattapan",
      tripId: "77714341",
      stopId: "70270",
      currentStatus: "INCOMING_AT",
      revenue: "REVENUE",
      speed: 13.2,
    });
    expect(typeof v?.lat).toBe("number");
    expect(v?.updatedAt).toBeInstanceOf(Date);
    expect(Array.isArray(v?.carriages)).toBe(true);
  });

  it("運行時間外の空の応答は 0 件", async () => {
    const { rows, rejected } = parseVehicles(await readFixture("cases/vehicles-off-hours.json"));
    expect(rows).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it("stop が null の車両は stopId が null", async () => {
    const { rows } = parseVehicles(await readFixture("cases/vehicles-stop-null.json"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stopId).toBeNull();
  });

  it("updated_at が 30 分前の車両も、そのまま解析する（除外は到着検出側で行う）", async () => {
    const { rows } = parseVehicles(await readFixture("cases/vehicles-stale.json"));
    expect(rows).toHaveLength(2);
    for (const v of rows) {
      expect(SUNDAY.recordedAt.getTime() - v.updatedAt.getTime()).toBeGreaterThan(20 * 60_000);
    }
  });

  it("終点の番線 ID（Alewife-01 など）をそのまま保持する", async () => {
    const { rows } = parseVehicles(await readFixture("cases/vehicles-terminal-track.json"));
    expect(rows.map((v) => v.stopId).sort()).toEqual([
      "Alewife-01",
      "Forest Hills-02",
      "Oak Grove-02",
    ]);
  });

  it("スキーマに合わない行はスキップし、残りを返す", async () => {
    const { rows, rejected } = parseVehicles(await readFixture("cases/vehicles-malformed.json"));
    expect(rows).toHaveLength(2);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((r) => r.index)).toEqual([2, 3]);
  });
});

describe("parsePredictions", () => {
  it("平日の日中の 2,278 件をすべて解析できる", async () => {
    const { rows, rejected } = parsePredictions(await readFixture(WEEKDAY.predictions));
    expect(rows).toHaveLength(2278);
    expect(rejected).toEqual([]);
  });

  it("CANCELLED は到着・出発時刻がどちらも null", async () => {
    const { rows } = parsePredictions(await readFixture("cases/predictions-cancelled.json"));
    expect(rows).toHaveLength(38);
    for (const p of rows) {
      expect(p.scheduleRelationship).toBe("CANCELLED");
      expect(p.arrivalTime).toBeNull();
      expect(p.departureTime).toBeNull();
    }
  });

  it("SKIPPED をそのまま保持する", async () => {
    const { rows } = parsePredictions(await readFixture("cases/predictions-skipped.json"));
    expect(rows.map((p) => p.scheduleRelationship)).toEqual(["SKIPPED", "SKIPPED"]);
  });

  it("始発駅は arrivalTime が null で departureTime だけがある", async () => {
    const { rows } = parsePredictions(await readFixture("cases/predictions-origin.json"));
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) {
      expect(p.arrivalTime).toBeNull();
      expect(p.departureTime).toBeInstanceOf(Date);
    }
  });

  it("uncertaintySec は到着の不確かさ、なければ出発の不確かさ。時刻がある予測では update_type と対応している", async () => {
    const { rows } = parsePredictions(await readFixture(WEEKDAY.predictions));
    const byType = new Map<string, Set<number | null>>();
    // 到着・出発時刻がどちらも null の予測（通過など）は、不確かさも null
    for (const p of rows.filter((r) => r.arrivalTime === null && r.departureTime === null)) {
      expect(p.uncertaintySec).toBeNull();
    }
    for (const p of rows.filter((r) => r.arrivalTime !== null || r.departureTime !== null)) {
      const key = p.updateType ?? "null";
      byType.set(key, (byType.get(key) ?? new Set()).add(p.uncertaintySec));
    }
    expect(byType.get("MID_TRIP")).toEqual(new Set([60]));
    expect(byType.get("AT_TERMINAL")).toEqual(new Set([120]));
    expect(byType.get("REVERSE_TRIP")).toEqual(new Set([360]));
  });

  it("運行時間外の空の応答は 0 件", async () => {
    const { rows } = parsePredictions(await readFixture("cases/predictions-off-hours.json"));
    expect(rows).toEqual([]);
  });
});

describe("parseAlerts", () => {
  it("アラートをすべて解析できる", async () => {
    expect(parseAlerts(await readFixture(WEEKDAY.alerts)).rows).toHaveLength(12);
    expect(parseAlerts(await readFixture(SUNDAY.alerts)).rows).toHaveLength(15);
  });

  it("UPCOMING のアラートも解析し、有効期間の end が null でもよい", async () => {
    const { rows } = parseAlerts(await readFixture("cases/alerts-upcoming.json"));
    expect(rows.length).toBeGreaterThan(0);
    for (const a of rows) expect(a.lifecycle).toBe("UPCOMING");
    const { rows: all } = parseAlerts(await readFixture(SUNDAY.alerts));
    expect(all.some((a) => a.activePeriod.some((p) => p.end === null))).toBe(true);
  });

  it("対象 8 路線の route ID を informed_entity から取り出す", async () => {
    const { rows } = parseAlerts(await readFixture(SUNDAY.alerts));
    for (const a of rows) {
      expect(a.routeIds.length).toBeGreaterThan(0);
      for (const r of a.routeIds) expect(r).toMatch(/^(Red|Mattapan|Orange|Blue|Green-[BCDE])$/);
    }
  });

  it("effect・cause・lifecycle は列挙型にせず文字列のまま、severity は整数", async () => {
    const { rows } = parseAlerts(await readFixture(SUNDAY.alerts));
    expect(new Set(rows.map((a) => a.effect))).toContain("NOTICE");
    expect(rows.every((a) => Number.isInteger(a.severity))).toBe(true);
  });
});
