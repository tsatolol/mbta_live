// 002 TR-002: 駅の到着表示の計算（時計を固定する）
import { describe, expect, it } from "vitest";
import {
  alertAppliesToStation,
  nextArrivals,
  predictionTime,
  type PredictionInput,
} from "@/lib/metrics/arrival-board";

const now = new Date("2026-11-02T15:20:00Z");
const at = (sec: number) => new Date(now.getTime() + sec * 1000);

function p(
  id: string,
  arrival: number | null,
  departure: number | null = null,
  rel: string | null = null,
): PredictionInput & { id: string } {
  return {
    id,
    arrivalTime: arrival === null ? null : at(arrival),
    departureTime: departure === null ? null : at(departure),
    scheduleRelationship: rel,
  };
}

describe("predictionTime", () => {
  it("到着時刻があればそれを、なければ（始発駅）出発時刻を使う", () => {
    expect(predictionTime(p("a", 60, 90))).toEqual({ time: at(60), timeKind: "arrival" });
    expect(predictionTime(p("a", null, 90))).toEqual({ time: at(90), timeKind: "departure" });
    expect(predictionTime(p("a", null, null))).toBeNull();
  });
});

describe("nextArrivals", () => {
  it("時刻の順に 3 本", () => {
    const result = nextArrivals([p("d", 400), p("a", 100), p("c", 300), p("b", 200)], now);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("SKIPPED・時刻のない便・過ぎた便（ちょうど今を含む）を除く", () => {
    const result = nextArrivals(
      [p("skip", 100, null, "SKIPPED"), p("none", null), p("past", -10), p("now", 0), p("ok", 50)],
      now,
    );
    expect(result.map((r) => r.id)).toEqual(["ok"]);
  });

  it("時刻のある運休の便は残す", () => {
    const result = nextArrivals([p("c", 100, null, "CANCELLED"), p("x", 200)], now);
    expect(result.map((r) => [r.id, r.scheduleRelationship])).toEqual([
      ["c", "CANCELLED"],
      ["x", null],
    ]);
  });

  it("始発駅の便は出発時刻で並べる", () => {
    const result = nextArrivals([p("b", null, 200), p("a", null, 100)], now);
    expect(result.map((r) => [r.id, r.timeKind])).toEqual([
      ["a", "departure"],
      ["b", "departure"],
    ]);
  });
});

describe("alertAppliesToStation", () => {
  const station = { routeIds: ["Orange"], stopIds: ["place-jaksn", "70006", "70007"] };

  it("駅かそのホームを指すアラート", () => {
    expect(alertAppliesToStation([{ route: "Orange", stop: "70006" }], station)).toBe(true);
    expect(alertAppliesToStation([{ route: "Orange", stop: "place-jaksn" }], station)).toBe(true);
  });

  it("駅の路線全体のアラート（駅の指定なし）", () => {
    expect(alertAppliesToStation([{ route: "Orange" }], station)).toBe(true);
  });

  it("ほかの駅だけ、ほかの路線だけのアラートは関係しない", () => {
    expect(alertAppliesToStation([{ route: "Orange", stop: "place-ogmnl" }], station)).toBe(false);
    expect(alertAppliesToStation([{ route: "Red" }], station)).toBe(false);
    expect(alertAppliesToStation([], station)).toBe(false);
  });
});
