// 005 TR-004: axe-core によるアクセシビリティの検査（WCAG 2.2 AA）。明るい表示と暗い表示の両方。
// 画面はユーザーストーリーごとに足す（US1: 共通のヘッダーとフッター = 稼働状況の画面で確かめる）
import { expect, test } from "@playwright/test";
import { axeViolations, COLOR_SCHEMES, formatViolations } from "./helpers/a11y";
import { seedE2e } from "./helpers/seed";

const PAGES = [
  { name: "稼働状況（共通のヘッダーとフッターを含む）", path: "/status", ready: "job-collect" },
];

test.describe("アクセシビリティ（axe-core）", () => {
  test.beforeAll(() => {
    seedE2e("base");
  });

  for (const scheme of COLOR_SCHEMES) {
    for (const { name, path, ready } of PAGES) {
      test(`${name}: ${scheme === "light" ? "明るい" : "暗い"}表示で違反がない`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({ colorScheme: scheme, baseURL });
        const page = await context.newPage();
        await page.goto(path);
        await page.getByTestId(ready).waitFor();
        const violations = await axeViolations(page);
        expect(violations, formatViolations(violations)).toEqual([]);
        await context.close();
      });
    }
  }

  test("スマホのメニューを開いた状態でも違反がない", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL,
    });
    const page = await context.newPage();
    await page.goto("/status");
    await page.getByTestId("menu-button").click();
    await page.getByTestId("menu-panel").waitFor();
    const violations = await axeViolations(page);
    expect(violations, formatViolations(violations)).toEqual([]);
    await context.close();
  });
});
