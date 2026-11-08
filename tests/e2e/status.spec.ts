// 002 TR-003: 稼働状況の画面（US4）。共通部分（最終更新時刻・stale バナー・DEV バッジ・出典表記）は layout.spec.ts
import { expect, test } from "@playwright/test";
import { statusResponseSchema } from "@/lib/api-schemas/status";
import { seedE2e } from "./helpers/seed";

test.describe("稼働状況", () => {
  test("直近の収集の結果、レート制限の残量、DB のデータ量が出る", async ({ page }) => {
    seedE2e("base");
    await page.goto("/status");

    await expect(page.getByTestId("status-summary")).toContainText(
      "Collection is running normally",
    );
    await expect(page.getByTestId("status-summary").locator("svg")).toBeVisible();
    const collect = page.getByTestId("job-collect");
    await expect(collect.getByTestId("job-last-status")).toHaveText("success");
    await expect(collect.getByTestId("job-last-success")).toContainText("just now");
    const run = collect.getByTestId("job-run").first();
    await expect(run).toHaveAttribute("data-status", "success");
    await expect(run).toContainText("vehicles 106 · predictions 2,278 · alerts 12");
    await expect(collect.getByTestId("job-24h")).toHaveText("Last 24 h: 1 run, 0 failed");

    // シードではジョブとして動かしていない
    await expect(page.getByTestId("job-sync-static").getByTestId("job-last-status")).toHaveText(
      "never run",
    );

    await expect(page.getByTestId("rate-limit-value")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("table-vehicles_current").getByTestId("table-rows")).toHaveText(
      "106",
    );
    await expect(
      page.getByTestId("table-predictions_current").getByTestId("table-rows"),
    ).toHaveText("2,278");
    await expect(page.getByTestId("table-vehicle_positions").getByTestId("table-rows")).toHaveText(
      /^~?\d[\d,]*$/,
    );
  });

  test("収集が止まっていると、最後の成功からの経過時間と stale バナーが出る", async ({ page }) => {
    seedE2e("stale-collection");
    await page.goto("/status");
    await expect(page.getByTestId("status-summary")).toContainText("Collection is delayed");
    await expect(page.getByTestId("status-summary").locator(".stale-stripes")).toBeVisible();
    await expect(page.getByTestId("stale-banner")).toContainText("Live data is stale");
    await expect(page.getByTestId("last-collected")).toContainText("4 min ago");
  });
});

test("収集の失敗を警告し、未実行の状態も正常と区別する", async ({ page }) => {
  seedE2e("base");
  const source = statusResponseSchema.parse(await (await page.request.get("/api/status")).json());
  await page.route("**/api/status", (route) =>
    route.fulfill({
      json: {
        ...source,
        jobs: source.jobs.map((job) =>
          job.job === "collect"
            ? {
                ...job,
                failedLast24h: 1,
                lastRun: job.lastRun ? { ...job.lastRun, status: "failed" } : null,
              }
            : job,
        ),
      },
    }),
  );
  await page.goto("/status");
  await expect(page.getByTestId("status-summary")).toContainText("latest collection failed");
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { ...source, lastCollectedAt: null, jobs: [] } }),
  );
  await page.reload();
  await expect(page.getByTestId("status-summary")).toHaveText("No collection has succeeded yet.");
});
