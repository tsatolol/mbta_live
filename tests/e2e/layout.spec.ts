// 002 TR-003: 共通部分（ヘッダーの最終更新時刻、stale バナー、DEV バッジ、フッターの出典表記）
// 稼働状況の画面の E2E は US4（T032）で足す
import { expect, test } from "@playwright/test";
import { seedE2e } from "./helpers/seed";

test.describe("共通のレイアウト", () => {
  test.beforeEach(() => {
    seedE2e("base");
  });

  test("ヘッダーに最終更新時刻（ボストン時間）が出る", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("last-updated")).toHaveText(
      /^Last updated \d{1,2}:\d{2}:\d{2} (AM|PM) ET$/,
    );
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  });

  test("dev では DEV バッジが出る", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("env-badge")).toHaveText("DEV");
  });

  test("フッターに出典表記が出る", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByTestId("footer");
    await expect(footer).toContainText("Data provided by MBTA");
    await expect(footer).toContainText("© OpenFreeMap © OpenStreetMap contributors");
  });

  test("収集が 3 分以上止まると stale バナーが出る", async ({ page }) => {
    seedE2e("stale-collection");
    await page.goto("/");
    await expect(page.getByTestId("stale-banner")).toContainText("Live data is stale");
  });

  test("ブラウザから MBTA API を呼ばない（TR-004）", async ({ page }) => {
    const mbtaRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "api-v3.mbta.com") mbtaRequests.push(request.url());
    });
    await page.goto("/");
    // ヘッダーが 30 秒ごとに取得し続けるので networkidle は待てない。表示されてから少し待って確かめる
    await expect(page.getByTestId("last-updated")).toHaveText(/^Last updated/);
    await page.waitForTimeout(2_000);
    expect(mbtaRequests).toEqual([]);
  });
});
