import { describe, expect, it } from "vitest";
import { statusSummary } from "@/lib/display/status-summary";
const now = new Date("2026-11-08T15:20:00Z");
const source = (seconds = 12, failures = 0, lastStatus = "success") => ({
  lastCollectedAt: new Date(now.getTime() - seconds * 1_000).toISOString(),
  jobs: [{ job: "collect", failedLast24h: failures, lastRun: { status: lastStatus } }],
});
describe("statusSummary", () => {
  it("正常な収集は最終成功からの経過時間とともに伝える", () => {
    expect(statusSummary(source(), now)).toEqual({
      state: "healthy",
      text: "Collection is running normally. The last successful run was 12 s ago.",
    });
  });
  it.each([179, 180, 240])("%s 秒の境目で古い成功を警告する", (seconds) => {
    expect(statusSummary(source(seconds), now).state).toBe(seconds < 180 ? "healthy" : "warning");
  });
  it("最後の実行が失敗していれば、直近の成功が新しくても警告する", () => {
    expect(statusSummary(source(12, 1, "failed"), now).text).toContain("latest collection failed");
    expect(statusSummary(source(12, 1, "failed"), now).state).toBe("warning");
  });
  it.each([
    [1, "1 failure"],
    [3, "3 failures"],
  ])("24 時間内の %s 回の失敗を正しく表示する", (n, label) => {
    const result = statusSummary(source(12, n), now);
    expect(result.state).toBe("warning");
    expect(result.text).toContain(`${label} in the last 24 hours`);
  });
  it("成功がまだなければ正常とは言わない", () => {
    expect(statusSummary({ lastCollectedAt: null, jobs: [] }, now)).toEqual({
      state: "none",
      text: "No collection has succeeded yet.",
    });
  });
  it("未実行の別ジョブは collector の正常判定を変えない", () => {
    const data = source();
    data.jobs.push({ job: "sync-static", failedLast24h: 4, lastRun: { status: "failed" } });
    expect(statusSummary(data, now).state).toBe("healthy");
  });
});
