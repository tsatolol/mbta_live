// TR-002: 到着検出の性質をプロパティベーステスト（fast-check）で確かめる
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  detectArrivals,
  type ArrivalEventRow,
  type VehicleObservation,
} from "@/lib/metrics/arrivals";
import { at, index, prediction, STATIONS, vehicleAt } from "../../helpers/arrival-fixtures";

const STATUSES = ["STOPPED_AT", "INCOMING_AT", "IN_TRANSIT_TO"] as const;

/** 1 両の車両が A → E へ進む様子を、収集ごとの観測の列として作る */
const journeyArb = fc
  .array(
    fc.record({
      advance: fc.integer({ min: 0, max: 3 }),
      status: fc.constantFrom(...STATUSES),
      gapSec: fc.integer({ min: 30, max: 300 }),
      withPredictions: fc.boolean(),
    }),
    { minLength: 2, maxLength: 12 },
  )
  .map((steps) => {
    let pos = 0;
    let t = 0;
    let prevStatus: string = "STOPPED_AT";
    return steps.map((s, i) => {
      if (i > 0) pos = Math.min(STATIONS.length - 1, pos + s.advance);
      t += s.gapSec;
      // 停車中から同じ駅に「向かっている」ことはないので、そのときは停車中のままにする
      const status =
        i > 0 && s.advance === 0 && prevStatus === "STOPPED_AT" ? "STOPPED_AT" : s.status;
      prevStatus = status;
      return { pos, status, t, withPredictions: s.withPredictions };
    });
  });

describe("到着検出の性質", () => {
  it("便と親駅の組で到着は 1 件、到着時刻は停車順に沿って減らない、観測した時間の範囲に収まる", () => {
    fc.assert(
      fc.property(journeyArb, (journey) => {
        // DB の主キー（運行日, 便, 親駅）と同じく、最初に記録したものを残す
        const recorded = new Map<string, ArrivalEventRow>();
        let prev: VehicleObservation | null = null;
        let prevPreds: ReturnType<typeof prediction>[] = [];
        for (const step of journey) {
          const now = at(step.t);
          const curr = vehicleAt(step.pos, step.status, now);
          const { events } = detectArrivals({
            prevVehicles: prev ? [prev] : [],
            prevPredictions: prevPreds,
            prevPolledAt: prev ? prev.updatedAt : null,
            currVehicles: [curr],
            index,
            now,
          });
          const keys = events.map((e) => `${e.serviceDate}|${e.tripId}|${e.stopId}`);
          expect(new Set(keys).size).toBe(keys.length);
          for (const [i, e] of events.entries())
            if (!recorded.has(keys[i] ?? "")) recorded.set(keys[i] ?? "", e);

          prev = curr;
          // 次の収集のための予測: 今いる駅から先の駅に、少し先の時刻を置く
          prevPreds = step.withPredictions
            ? STATIONS.map((_, i) => i)
                .filter((i) => i >= step.pos)
                .map((i) => prediction(i, at(step.t + (i - step.pos) * 90)))
            : [];
        }

        const byOrder = [...recorded.values()].sort(
          (a, b) =>
            STATIONS.indexOf(a.stopId as (typeof STATIONS)[number]) -
            STATIONS.indexOf(b.stopId as (typeof STATIONS)[number]),
        );
        const first = at(journey[0]?.t ?? 0).getTime();
        const last = at(journey.at(-1)?.t ?? 0).getTime();
        for (const [i, e] of byOrder.entries()) {
          expect(e.arrivedAt.getTime()).toBeGreaterThanOrEqual(first);
          expect(e.arrivedAt.getTime()).toBeLessThanOrEqual(last);
          const next = byOrder[i + 1];
          if (next) expect(next.arrivedAt.getTime()).toBeGreaterThanOrEqual(e.arrivedAt.getTime());
        }
      }),
      { numRuns: 500 },
    );
  });
});
