// 005 TR-006: 表示の明るさ（OS の設定に合わせる、切り替えて残る、最初の描画から正しい、キーボードで操作できる）
import { expect, test, type Page } from "@playwright/test";
import { seedE2e } from "./helpers/seed";

/** 背景の色（トークンの --surface） */
const LIGHT_BG = "rgb(243, 245, 246)";
const DARK_BG = "rgb(16, 24, 29)";

async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.describe("表示の明るさ", () => {
  test.beforeAll(() => {
    seedE2e("base");
  });

  test("OS が暗い表示なら暗い表示で出る。既定は「System」", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/status");
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
    await context.close();
  });

  test("切り替えると変わり、読み込み直しても残る。System に戻すと OS に合わせる", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/status");
    expect(await bodyBackground(page)).toBe(LIGHT_BG);

    await page.getByTestId("theme-dark").click();
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bodyBackground(page)).toBe(DARK_BG);

    await page.reload();
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("theme-system").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
    await context.close();
  });

  test("最初に描かれた時点で、選んだ表示になっている（明るい表示が一瞬出ない）", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    await context.addInitScript(() => {
      window.localStorage.setItem("mbta-live:theme", "dark");
      // HTML を読み終えた時点（React が動く前）の表示を記録する
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __firstPaint: unknown }).__firstPaint = {
          theme: document.documentElement.getAttribute("data-theme"),
          bg: getComputedStyle(document.documentElement).backgroundColor,
        };
      });
    });
    const page = await context.newPage();
    await page.goto("/status");
    const first = await page.evaluate(
      () => (window as unknown as { __firstPaint: { theme: string; bg: string } }).__firstPaint,
    );
    expect(first).toEqual({ theme: "dark", bg: DARK_BG });
    await context.close();
  });

  test("キーボードで切り替えられ、選んでいるものが名前でも分かる", async ({ page }) => {
    await page.goto("/status");
    const system = page.getByTestId("theme-system");
    await system.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("theme-dark")).toBeFocused();
    await expect(page.getByTestId("theme-dark")).toContainText("Dark");
    await expect(system).toHaveAttribute("aria-checked", "false");
    await expect(system).not.toContainText("System");
  });

  test("保存できない（プライベートブラウズなど）ときもエラーにならず、OS に合わせる", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("SecurityError");
        },
      });
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/status");
    expect(await bodyBackground(page)).toBe(DARK_BG);
    await page.getByTestId("theme-light").click();
    expect(await bodyBackground(page)).toBe(LIGHT_BG);
    expect(errors).toEqual([]);
    await context.close();
  });
});
