// 002 TR-003・005 US1: 共通部分（ヘッダーのデータの鮮度、stale の帯、DEV バッジ、フッターの出典表記、
// 1 行のヘッダーとスマホのメニュー）。表示の明るさの切り替えは theme.spec.ts
import { expect, test } from "@playwright/test";
import { seedE2e } from "./helpers/seed";

test.describe("共通のレイアウト", () => {
  test.beforeEach(() => {
    seedE2e("base");
  });

  test("ヘッダーにデータの鮮度が経過時間で出て、毎秒進む。押すと正確な時刻（ボストン時間）が出る", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto("/");
    const label = page.getByTestId("last-updated");
    await expect(label).toHaveText(/^Updated (just now|\d+ s ago)$/, { useInnerText: true });
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);

    // 時計を進めると、読み込み直さなくても経過時間が進む
    await page.clock.runFor(70_000);
    await expect(label).toHaveText(/^Updated 1 min ago$/, { useInnerText: true });

    await label.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Last successful collection" }),
    ).toHaveText(/^Last successful collection: \w{3} \d{1,2}, \d{1,2}:\d{2}:\d{2} (AM|PM) ET$/);
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

  test("収集が 3 分以上止まると、縞と警告と文言の帯が出る", async ({ page }) => {
    seedE2e("stale-collection");
    await page.goto("/");
    const banner = page.getByTestId("stale-banner");
    await expect(banner).toContainText("Live data is stale");
    await expect(banner).toContainText(/was 4 min ago, at \d{1,2}:\d{2} (AM|PM) ET\./);
    // 色だけに頼らない: 縞と警告のアイコンがある
    await expect(banner.locator(".stale-stripes")).toHaveCount(1);
    await expect(banner.locator("svg")).toHaveCount(1);
  });

  test("スマホ（390px）: ヘッダーは 1 行で 64px 以下。画面の切り替えはメニューから（SC-001）", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const header = page.locator("header").first();
    const box = await header.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(64);
    await expect(page.getByTestId("last-updated")).toHaveText(/^(now|\d+ s)$/, {
      useInnerText: true,
    });

    const menu = page.getByTestId("menu-button");
    await expect(page.getByTestId("menu-panel")).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("menu-panel").getByRole("link", { name: "Stations" }).click();
    await expect(page).toHaveURL(/\/stations$/);
    // 画面を移ったら閉じる
    await expect(page.getByTestId("menu-panel")).toBeHidden();

    // Esc で閉じ、フォーカスはメニューのボタンに戻る
    await menu.click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("menu-panel")).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("ブラウザから MBTA API を呼ばない（TR-004）", async ({ page }) => {
    const mbtaRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "api-v3.mbta.com") mbtaRequests.push(request.url());
    });
    await page.goto("/");
    // ヘッダーが 30 秒ごとに取得し続けるので networkidle は待てない。表示されてから少し待って確かめる
    await expect(page.getByTestId("last-updated")).toHaveText(/^Updated/, { useInnerText: true });
    await page.waitForTimeout(2_000);
    expect(mbtaRequests).toEqual([]);
  });
});
