// リアルタイム画面（002）の内部 API が読むクエリ。DB を読むだけ（Web は読み取り専用。憲章）。
import "server-only";
import type { Db } from "./client";

/** 最後に collector が成功した時刻（collector_runs）。一度もなければ null */
export async function getLastCollectedAt(db: Db): Promise<Date | null> {
  const run = await db.collectorRun.findFirst({
    where: { job: "collect", status: "success" },
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true },
  });
  return run?.finishedAt ?? null;
}
