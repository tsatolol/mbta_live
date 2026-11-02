// 連続ポーリングの記録（tests/fixtures/mbta/sequences/<名前>/）を読む
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { FIXTURES_DIR } from "./fixtures";
import type { FakeMbtaOptions } from "./fake-mbta";

const indexSchema = z.object({
  polls: z.array(z.object({ step: z.number(), polledAt: z.string() })),
});

export interface RecordedPoll {
  step: number;
  polledAt: Date;
  bodies: FakeMbtaOptions["bodies"];
}

export async function loadSequence(name: string): Promise<RecordedPoll[]> {
  const dir = path.join(FIXTURES_DIR, "sequences", name);
  const index = indexSchema.parse(JSON.parse(await readFile(path.join(dir, "index.json"), "utf8")));
  const read = async (step: number, key: string): Promise<unknown> =>
    JSON.parse(
      gunzipSync(
        await readFile(path.join(dir, `${String(step).padStart(3, "0")}-${key}.json.gz`)),
      ).toString("utf8"),
    );
  return Promise.all(
    index.polls.map(async ({ step, polledAt }) => ({
      step,
      polledAt: new Date(polledAt),
      bodies: {
        vehicles: await read(step, "vehicles"),
        predictions: await read(step, "predictions"),
        alerts: await read(step, "alerts"),
      },
    })),
  );
}
