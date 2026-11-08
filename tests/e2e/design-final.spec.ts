// 005 T056 / T059: 明暗の段階と、色以外の手がかりを実ブラウザで検査する。
import { expect, test } from "@playwright/test";
import { seedE2e } from "./helpers/seed";
import { stubMapTiles, waitForMap } from "./helpers/map";

test.beforeAll(() => seedE2e("analytics"));
for (const scheme of ["light", "dark"] as const) {
  test(`ヒートマップの ${scheme} の段階は CSS と一致する`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/analytics/patterns");
    await expect(page.getByTestId("analytics-summary")).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__mbtaCharts?.["pattern-heatmap"]));
    const colors = await page.evaluate(() => {
      const option = window.__mbtaCharts!["pattern-heatmap"]!.getOption() as {
        visualMap: { inRange: { color: string[] } }[];
      };
      const css = getComputedStyle(document.body);
      return {
        actual: option.visualMap[0]!.inRange.color,
        expected: Array.from({ length: 7 }, (_, i) =>
          css.getPropertyValue(`--seq-${i + 1}`).trim(),
        ),
      };
    });
    expect(colors.actual).toEqual(colors.expected);
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    };
    for (let i = 1; i < colors.actual.length; i++) {
      const previous = luminance(colors.actual[i - 1]!);
      const current = luminance(colors.actual[i]!);
      expect(scheme === "dark" ? current > previous : current < previous).toBe(true);
    }
  });
}

for (const deficiency of ["protanopia", "deuteranopia", "achromatopsia"] as const) {
  test(`${deficiency} でも重要度を文言・縞・アイコンで区別できる`, async ({ page, context }) => {
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setEmulatedVisionDeficiency", { type: deficiency });
    await page.goto("/alerts");
    const disruption = page
      .locator('[data-testid="alert-card"][data-category="disruption"]')
      .first();
    const notice = page.locator('[data-testid="alert-card"][data-category="notice"]').first();
    await expect(disruption).toContainText("Disruption");
    await expect(disruption.locator(".stale-stripes")).toBeVisible();
    await expect(disruption.locator("svg")).toBeVisible();
    await expect(notice).toContainText("Notice");
    await expect(notice.locator("svg")).toBeVisible();
    await client.detach();
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`forced-colors (${scheme}) でも凡例・テーマ・検索結果の形と選択が分かる`, async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active", colorScheme: scheme });
    await stubMapTiles(page);
    await page.goto("/");
    await waitForMap(page);
    const red = page.getByTestId("route-filter-Red");
    await expect(red).toHaveAttribute("aria-pressed", "true");
    await red.click();
    await expect(red).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("theme-dark").click();
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
    await page.goto("/stations");
    await page.getByTestId("station-search").fill("Park Street");
    const matches = page.locator('[data-search-match="true"]');
    await expect(matches).toHaveCount(2);
    await expect(matches.first()).toHaveCSS("font-weight", "800");
    await page.goto("/alerts");
    await expect(page.locator('[data-category="disruption"]').first()).toContainText("Disruption");
    // axe の forced-colors 判定は authored color を拾うため、実際の描画色を直接検証する。
    // 通常の明暗の WCAG 検査は a11y.spec.ts で除外を増やさず実行する。
    const colors = await page.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.querySelector("h1")!).color,
    }));
    const luminance = (color: string) => {
      const components = color
        .match(/\d+(?:\.\d+)?/g)!
        .slice(0, 3)
        .map(Number)
        .map((c) => c / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return components[0]! * 0.2126 + components[1]! * 0.7152 + components[2]! * 0.0722;
    };
    const foreground = luminance(colors.foreground);
    const background = luminance(colors.background);
    expect(
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  });
}

for (const path of [
  "/alerts",
  "/status",
  "/analytics/headways",
  "/analytics/predictions",
  "/analytics/alerts",
  "/analytics/patterns",
]) {
  test(`${path} は幅320pxでページの横にはみ出さない`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(path);
    const ready =
      path === "/alerts"
        ? "active-alerts"
        : path === "/status"
          ? "status-summary"
          : "analytics-summary";
    await expect(page.getByTestId(ready)).toBeVisible();
    if (path.startsWith("/analytics")) {
      const details = page.locator("details").first();
      if (await details.count()) await details.locator("summary").click();
    }
    const size = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      actual: document.documentElement.scrollWidth,
    }));
    expect(size.actual).toBe(size.viewport);
  });
}
