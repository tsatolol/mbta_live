// 002 の内部 API の結合テスト用: 静的データと、平日 10:20 ET の現在値を入れる（本番と同じ collector の処理で取り込む）
import { fixedClock } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { createMbtaClient } from "@/lib/mbta/client";
import { runCollect } from "@/jobs/collect";
import { fakeMbtaFetch } from "./fake-mbta";
import { readFixture, WEEKDAY } from "./fixtures";
import { seedStaticFromFixtures } from "./seed";
import { testDatabaseUrl } from "./test-env";

/** 記録した時刻（API を呼ぶときの「今」の基準） */
export const LIVE_RECORDED_AT = WEEKDAY.recordedAt;

export async function seedLive(db: Db): Promise<void> {
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
    connectionString: testDatabaseUrl(),
  });
  if (result.status !== "success") throw new Error(`collector が失敗しました: ${result.status}`);
}

/** Route Handler に渡す Request を作る */
export function apiRequest(pathWithQuery: string): Request {
  return new Request(`http://localhost${pathWithQuery}`);
}
