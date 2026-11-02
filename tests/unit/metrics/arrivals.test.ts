// TR-002: 到着検出（入力と期待値の表）
import { describe, expect, it } from "vitest";
import { detectArrivals, type DetectArrivalsInput } from "@/lib/metrics/arrivals";
import { createStopIndex } from "@/lib/metrics/stop-index";
import { at, index, prediction, T0, vehicle, vehicleAt } from "../../helpers/arrival-fixtures";

function run(overrides: Partial<DetectArrivalsInput>) {
  return detectArrivals({
    prevVehicles: [],
    prevPredictions: [],
    prevPolledAt: at(-60),
    currVehicles: [],
    index,
    now: T0,
    ...overrides,
  });
}

const simplify = (r: ReturnType<typeof run>) =>
  r.events.map((e) => ({ stop: e.stopId, source: e.source, at: e.arrivedAt.toISOString() }));

describe("1. 停車中（stopped_at）", () => {
  it("STOPPED_AT の車両は、その親駅への到着を updated_at で記録する", () => {
    const r = run({ currVehicles: [vehicleAt(1, "STOPPED_AT", at(-10))] });
    expect(r.events).toEqual([
      {
        serviceDate: "2026-11-02",
        tripId: "t1",
        stopId: "place-b",
        routeId: "R",
        directionId: 0,
        vehicleId: "v1",
        arrivedAt: at(-10),
        source: "stopped_at",
        precisionSec: 60,
      },
    ]);
  });

  it("精度は前回の収集からの経過秒数。前回がなければ 60 秒", () => {
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0)], prevPolledAt: at(-300) }).events[0]
        ?.precisionSec,
    ).toBe(300);
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0)], prevPolledAt: null }).events[0]
        ?.precisionSec,
    ).toBe(60);
  });

  it("INCOMING_AT / IN_TRANSIT_TO だけでは到着にしない", () => {
    expect(run({ currVehicles: [vehicleAt(1, "INCOMING_AT", T0)] }).events).toEqual([]);
    expect(run({ currVehicles: [vehicleAt(1, "IN_TRANSIT_TO", T0)] }).events).toEqual([]);
  });

  it("終点の番線（A-01）は親駅に変換する", () => {
    const r = run({
      currVehicles: [vehicle({ stopId: "A-01", currentStopSequence: 10, updatedAt: T0 })],
    });
    expect(r.events.map((e) => e.stopId)).toEqual(["place-a"]);
  });
});

describe("2. 進んだ区間（predicted_last / interpolated）", () => {
  it("前回停車中の駅の次から今回の駅の手前までを、前回の予測時刻で記録する", () => {
    const r = run({
      prevVehicles: [vehicleAt(1, "STOPPED_AT", at(-60))],
      prevPredictions: [prediction(2, at(-30)), prediction(3, at(30))],
      currVehicles: [vehicleAt(3, "IN_TRANSIT_TO", T0)],
    });
    expect(simplify(r)).toEqual([
      { stop: "place-c", source: "predicted_last", at: at(-30).toISOString() },
    ]);
  });

  it("予測がなければ、前後の観測時刻から線形補間する", () => {
    const r = run({
      prevVehicles: [vehicleAt(1, "STOPPED_AT", at(-90))],
      currVehicles: [vehicleAt(4, "IN_TRANSIT_TO", T0)],
    });
    // B（停車中）と E（向かっている）の間の C, D を、-90 秒〜0 秒の間に等間隔で置く
    expect(simplify(r)).toEqual([
      { stop: "place-c", source: "interpolated", at: at(-60).toISOString() },
      { stop: "place-d", source: "interpolated", at: at(-30).toISOString() },
    ]);
    expect(r.events[0]?.precisionSec).toBe(90);
  });

  it("前回が向かっている途中なら、その駅も通過した駅に含める。今回停車中なら stopped_at も記録する", () => {
    const r = run({
      prevVehicles: [vehicleAt(1, "INCOMING_AT", at(-60))],
      prevPredictions: [prediction(1, at(-50))],
      currVehicles: [vehicleAt(3, "STOPPED_AT", at(-5))],
    });
    expect(simplify(r)).toEqual([
      { stop: "place-b", source: "predicted_last", at: at(-50).toISOString() },
      // 通過した B・C を、前回（-60 秒）と今回（-5 秒）の間に 3 等分して置く。C は 2/3 の位置
      {
        stop: "place-c",
        source: "interpolated",
        at: new Date(at(-60).getTime() + (55_000 * 2) / 3).toISOString(),
      },
      { stop: "place-d", source: "stopped_at", at: at(-5).toISOString() },
    ]);
  });

  it("予測時刻は前回と今回の観測時刻の間に収め、停車順に沿って減らないようにする", () => {
    const r = run({
      prevVehicles: [vehicleAt(0, "STOPPED_AT", at(-60))],
      prevPredictions: [prediction(1, at(-120)), prediction(2, at(-90)), prediction(3, at(600))],
      currVehicles: [vehicleAt(4, "IN_TRANSIT_TO", T0)],
    });
    expect(simplify(r).map((e) => e.at)).toEqual(
      [at(-60), at(-60), T0].map((d) => d.toISOString()),
    );
  });

  it("SKIPPED / CANCELLED の駅は到着を記録しない", () => {
    const r = run({
      prevVehicles: [vehicleAt(1, "STOPPED_AT", at(-60))],
      prevPredictions: [prediction(2, null, { scheduleRelationship: "SKIPPED" })],
      currVehicles: [vehicleAt(3, "IN_TRANSIT_TO", T0)],
    });
    expect(r.events).toEqual([]);
  });

  it("便が変わったときは、進んだ区間を推定しない", () => {
    const r = run({
      prevVehicles: [vehicleAt(1, "STOPPED_AT", at(-60), { tripId: "t0" })],
      currVehicles: [vehicleAt(4, "IN_TRANSIT_TO", T0)],
    });
    expect(r.events).toEqual([]);
  });

  it("路線パターンが見つからなければ、前回の予測の停車順で区間の駅を決める", () => {
    const noPatterns = createStopIndex(
      [
        { id: "place-b", locationType: 1, parentStationId: null },
        { id: "place-c", locationType: 1, parentStationId: null },
        { id: "place-d", locationType: 1, parentStationId: null },
        { id: "b1", locationType: 0, parentStationId: "place-b" },
        { id: "c1", locationType: 0, parentStationId: "place-c" },
        { id: "d1", locationType: 0, parentStationId: "place-d" },
      ],
      [],
    );
    const r = run({
      index: noPatterns,
      prevVehicles: [vehicleAt(1, "STOPPED_AT", at(-60))],
      prevPredictions: [prediction(2, at(-20)), prediction(3, at(20))],
      currVehicles: [vehicleAt(3, "IN_TRANSIT_TO", T0)],
    });
    expect(simplify(r)).toEqual([
      { stop: "place-c", source: "predicted_last", at: at(-20).toISOString() },
    ]);
  });
});

describe("対象外の車両", () => {
  it("updated_at が 180 秒以上前の車両（更新が止まっている）", () => {
    expect(run({ currVehicles: [vehicleAt(1, "STOPPED_AT", at(-180))] }).events).toEqual([]);
    expect(run({ currVehicles: [vehicleAt(1, "STOPPED_AT", at(-179))] }).events).toHaveLength(1);
  });

  it("営業していない車両（revenue が REVENUE でない、または null）", () => {
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0, { revenue: "NON_REVENUE" })] }).events,
    ).toEqual([]);
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0, { revenue: null })] }).events,
    ).toEqual([]);
  });

  it("便・方向がわからない車両、stop が null の車両", () => {
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0, { tripId: null })] }).events,
    ).toEqual([]);
    expect(
      run({ currVehicles: [vehicleAt(1, "STOPPED_AT", T0, { directionId: null })] }).events,
    ).toEqual([]);
    expect(run({ currVehicles: [vehicle({ stopId: null, updatedAt: T0 })] }).events).toEqual([]);
  });

  it("駅の索引にない stop ID は記録せず、unknownStopIds で返す", () => {
    const r = run({ currVehicles: [vehicle({ stopId: "X9", updatedAt: T0 })] });
    expect(r.events).toEqual([]);
    expect(r.unknownStopIds).toEqual(["X9"]);
  });
});

describe("運行日", () => {
  it("深夜 0〜3 時（ET）の到着は前日の運行日", () => {
    const night = new Date("2026-11-03T06:30:00Z"); // 01:30 EST
    const r = run({
      now: night,
      prevPolledAt: null,
      currVehicles: [vehicleAt(1, "STOPPED_AT", night)],
    });
    expect(r.events[0]?.serviceDate).toBe("2026-11-02");
  });
});
