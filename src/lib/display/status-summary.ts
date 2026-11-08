// 005 US5: API にある collector の観測だけから状態を説明する。時計は注入する。
import { freshnessLabel, freshnessState } from "./freshness";
interface StatusInput {
  lastCollectedAt: string | null;
  jobs: readonly { job: string; failedLast24h: number; lastRun: { status: string } | null }[];
}
export function statusSummary(
  data: StatusInput,
  now: Date,
): { state: "healthy" | "warning" | "none"; text: string } {
  if (!data.lastCollectedAt) return { state: "none", text: "No collection has succeeded yet." };
  const last = new Date(data.lastCollectedAt);
  const collector = data.jobs.find((job) => job.job === "collect");
  const success = `The last successful run was ${freshnessLabel(last, now)}.`;
  if (collector?.lastRun?.status === "failed")
    return { state: "warning", text: `The latest collection failed. ${success}` };
  if (freshnessState(last, now) === "stale")
    return { state: "warning", text: `Collection is delayed. ${success}` };
  const failures = collector?.failedLast24h ?? 0;
  if (failures > 0)
    return {
      state: "warning",
      text: `Collection is running, with ${failures} ${failures === 1 ? "failure" : "failures"} in the last 24 hours. ${success}`,
    };
  return { state: "healthy", text: `Collection is running normally. ${success}` };
}
