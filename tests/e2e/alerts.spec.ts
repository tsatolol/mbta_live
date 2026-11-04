// 002 TR-003: アラートの画面（US3）
import { expect, test } from "@playwright/test";
import { E2E_FIXTURES } from "./helpers/scenario";
import { seedE2e } from "./helpers/seed";

// フィクスチャのアラート: 有効 9 件、予告 3 件
const UPCOMING = ["1039322", "1039759", "1039769"];

test.describe("アラート", () => {
  test.beforeEach(() => {
    seedE2e("base");
  });

  test("有効なアラートが路線ごとに重要度の高い順で、effect のバッジ付きで出る", async ({
    page,
  }) => {
    await page.goto("/alerts");
    const active = page.getByTestId("active-alerts");
    await expect(active.getByTestId("alert-card")).toHaveCount(9);
    for (const card of await active.getByTestId("alert-card").all()) {
      await expect(card).toHaveAttribute("data-status", "active");
      await expect(card.getByTestId("alert-effect")).not.toBeEmpty();
    }
    // 路線の並び順にまとまる
    const groups = await active
      .getByTestId("alert-group")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-routes")));
    expect(groups).toEqual(["Red", "Orange", "Green-C", "Green-D", "Green-E"]);
    // まとまりの中は重要度の高い順
    const greenC = active.locator('[data-testid="alert-group"][data-routes="Green-C"]');
    await expect(greenC.getByTestId("alert-card")).toHaveCount(2);
    const jackson = active
      .locator('[data-testid="alert-card"][data-alert-id="1001861"]')
      .getByTestId("alert-effect");
    await expect(jackson).toHaveText("Station Issue");
  });

  test("予告のアラートは別の区画に出る", async ({ page }) => {
    await page.goto("/alerts");
    const upcoming = page.getByTestId("upcoming-alerts");
    await expect(upcoming.getByTestId("alert-card")).toHaveCount(3);
    const ids = await upcoming
      .getByTestId("alert-card")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-alert-id")));
    expect(ids.sort()).toEqual(UPCOMING);
    for (const id of UPCOMING) {
      await expect(
        page.getByTestId("active-alerts").locator(`[data-alert-id="${id}"]`),
      ).toHaveCount(0);
    }
    // 4 支線にまたがる SUSPENSION は、1 つのまとまりに 1 回だけ出る
    await expect(
      upcoming.locator(
        '[data-testid="alert-group"][data-routes="Green-B,Green-C,Green-D,Green-E"]',
      ),
    ).toHaveCount(1);
  });

  test("過去のアラートを期間・路線・影響の種類で検索できる", async ({ page }) => {
    await page.goto("/alerts");
    const search = page.getByTestId("alert-search");
    // 期間の既定は直近 7 日
    await search.getByTestId("search-route").selectOption("Red");
    await search.getByTestId("search-effect").selectOption("DELAY");
    await search.getByTestId("search-submit").click();
    const results = search.getByTestId("search-results");
    await expect(results.getByTestId("search-count")).toHaveText("1 alert");
    const card = results.getByTestId("alert-card");
    await expect(card).toHaveAttribute("data-alert-id", E2E_FIXTURES.pastAlert.id);
    await expect(card).toContainText(E2E_FIXTURES.pastAlert.header);
    await expect(card.getByTestId("alert-status")).toHaveText("Past");

    // 期間を過去のアラートより後にすると出ない
    const today = await search.getByTestId("search-to").inputValue();
    await search.getByTestId("search-from").fill(today);
    await search.getByTestId("search-submit").click();
    await expect(results.getByTestId("search-count")).toHaveText("0 alerts");

    // 影響の種類で絞ると、ほかの種類は出ない
    await search.getByTestId("search-route").selectOption("");
    await search.getByTestId("search-effect").selectOption("STATION_ISSUE");
    await search.getByTestId("search-submit").click();
    await expect(results.getByTestId("search-count")).toHaveText("3 alerts");
    for (const effect of await results.getByTestId("alert-effect").allTextContents()) {
      expect(effect).toBe("Station Issue");
    }
  });
});
