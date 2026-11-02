// US3: 連続した収集で、予測がバケットごとに 1 件だけ保存される（平日 12:28 ET からの 4 回分の実データ）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "@/lib/clock";
import { createMbtaClient } from "@/lib/mbta/client";
import { parsePredictions } from "@/lib/mbta/schemas/prediction";
import { LEAD_BUCKETS_MIN } from "@/lib/metrics/constants";
import { bucketForLead } from "@/lib/metrics/sampling";
import { runCollect } from "@/jobs/collect";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";
import { fakeMbtaFetch } from "../helpers/fake-mbta";
import { seedStaticFromFixtures } from "../helpers/seed";
import { loadSequence, type RecordedPoll } from "../helpers/sequence";

const db = createTestDb();
let polls: RecordedPoll[];
const insertedPerRun: number[] = [];

async function collectPoll(poll: RecordedPoll) {
  const client = createMbtaClient({ fetch: fakeMbtaFetch({ bodies: poll.bodies }) });
  return runCollect({
    db,
    client,
    clock: fixedClock(poll.polledAt),
    connectionString: testDatabaseUrl(),
  });
}

beforeAll(async () => {
  await resetData(db);
  await seedStaticFromFixtures(db);
  polls = await loadSequence("20261102-1228");
  for (const poll of polls) {
    const result = await collectPoll(poll);
    expect(result.status).toBe("success");
    const run = await db.collectorRun.findUniqueOrThrow({ where: { id: result.runId } });
    insertedPerRun.push((run.counts as Record<string, number>).samplesInserted ?? -1);
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("予測サンプル", () => {
  it("保存される。バケットは決めた 5 つのどれかで、リード時間はバケットの分数以下", async () => {
    const samples = await db.predictionSample.findMany();
    expect(samples.length).toBeGreaterThan(100);
    for (const s of samples) {
      expect(LEAD_BUCKETS_MIN).toContain(s.leadBucketMin);
      const lead = s.predictedArrivalAt.getTime() - s.observedAt.getTime();
      expect(lead).toBeGreaterThan(0);
      expect(lead).toBeLessThanOrEqual(s.leadBucketMin * 60_000);
      expect(s.stopId).toMatch(/^place-/);
    }
    expect(insertedPerRun.reduce((a, b) => a + b, 0)).toBe(samples.length);
  });

  it("各（便, 親駅, バケット）は、そのバケットに入った最初の回の観測が残る", async () => {
    const parents = new Map(
      (await db.stop.findMany({ select: { id: true, parentStationId: true } })).map((s) => [
        s.id,
        s.parentStationId,
      ]),
    );
    // 生の応答から「最初にそのバケットに入った回」を独立に求める
    const firstSeen = new Map<string, Date>();
    for (const poll of polls) {
      for (const p of parsePredictions(poll.bodies.predictions).rows) {
        if (
          !p.arrivalTime ||
          p.scheduleRelationship === "CANCELLED" ||
          p.scheduleRelationship === "SKIPPED"
        )
          continue;
        const bucket = bucketForLead((p.arrivalTime.getTime() - poll.polledAt.getTime()) / 1000);
        const station = parents.get(p.stopId);
        if (bucket === null || !station) continue;
        const key = `${p.tripId}|${station}|${bucket}`;
        if (!firstSeen.has(key)) firstSeen.set(key, poll.polledAt);
      }
    }
    const samples = await db.predictionSample.findMany();
    expect(samples).toHaveLength(firstSeen.size);
    for (const s of samples) {
      expect(s.observedAt).toEqual(firstSeen.get(`${s.tripId}|${s.stopId}|${s.leadBucketMin}`));
    }
  });

  it("同じ回をもう一度流しても、行は増えない", async () => {
    const before = await db.predictionSample.count();
    const last = polls.at(-1);
    if (!last) throw new Error("記録がありません");
    await collectPoll(last);
    expect(await db.predictionSample.count()).toBe(before);
  });
});
