// 002 TR-003・TR-004: 地図の画面（US1）
import { expect, test } from "@playwright/test";
import { stubMapTiles, vehicleFeatures, waitForMap } from "./helpers/map";
import { seedE2e } from "./helpers/seed";

const ROUTE_IDS = ["Red", "Mattapan", "Orange", "Green-B", "Green-C", "Green-D", "Green-E", "Blue"];

test.describe("地図", () => {
  test.beforeEach(async ({ page }) => {
    seedE2e("base");
    await stubMapTiles(page);
  });

  test("8 路線の形状と車両が出る", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    const routeIds = await page.evaluate(() => {
      const data = window.__mbtaMap?.getSource("routes")?.serialize().data as {
        features: { properties: { routeId: string } }[];
      };
      return [...new Set(data.features.map((f) => f.properties.routeId))];
    });
    expect(new Set(routeIds)).toEqual(new Set(ROUTE_IDS));
    const vehicles = await vehicleFeatures(page);
    expect(vehicles.length).toBe(106);
    await expect(page.getByTestId("vehicle-count")).toHaveText("106 trains");
  });

  test("路線フィルタで絞り込める", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    const red = (await vehicleFeatures(page)).filter((v) => v.routeId === "Red").length;
    await page.getByTestId("route-filter-Red").click();
    await expect(page.getByTestId("route-filter-Red")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("vehicle-count")).toHaveText(`${106 - red} trains`);
    const filter = await page.evaluate(() => window.__mbtaMap?.getFilter("vehicles"));
    expect(JSON.stringify(filter)).not.toContain('"Red"');
    expect(JSON.stringify(filter)).toContain('"Orange"');
  });

  test("更新の止まった車両は灰色", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    const vehicles = await vehicleFeatures(page);
    const stale = vehicles.filter((v) => v.isStale);
    expect(stale.length).toBeGreaterThan(0);
    for (const v of stale) expect(v.color).toBe("#8a969f");
    for (const v of vehicles.filter((x) => !x.isStale)) expect(v.color).not.toBe("#8a969f");
  });

  test("車両をクリックするとポップアップが出る", async ({ page }) => {
    await page.goto("/");
    await waitForMap(page);
    const target = (await vehicleFeatures(page)).find((v) => v.routeId === "Blue" && !v.isStale);
    expect(target).toBeDefined();
    // 車両の位置に地図を寄せてから、その画面上の位置をクリックする
    const point = await page.evaluate(
      ({ lon, lat }) =>
        new Promise<{ x: number; y: number }>((resolve) => {
          const map = window.__mbtaMap;
          if (!map) throw new Error("地図がありません");
          map.once("idle", () => resolve(map.project([lon, lat])));
          map.jumpTo({ center: [lon, lat], zoom: 16 });
        }),
      { lon: target!.lon, lat: target!.lat },
    );
    const box = await page.getByTestId("live-map").boundingBox();
    await page.mouse.click(box!.x + point.x, box!.y + point.y);
    const popup = page.getByTestId("vehicle-popup");
    await expect(popup).toBeVisible();
    await expect(popup.locator('[data-field="Route"]')).toHaveText("Blue");
    await expect(popup.locator('[data-field="Status"]')).not.toBeEmpty();
    await expect(popup.locator('[data-field="Updated"]')).toHaveText(/ago$/);
  });

  test("運行時間外は、そのことが分かる表示が出る", async ({ page }) => {
    seedE2e("out-of-service");
    await page.goto("/");
    await expect(page.getByTestId("out-of-service")).toContainText("No trains are running");
    await expect(page.getByTestId("vehicle-count")).toHaveText("0 trains");
  });

  test("凡例の路線数は車両と一致し、地図が画面を使う", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto("/");
    await waitForMap(page);
    const vehicles = await vehicleFeatures(page);
    for (const id of ROUTE_IDS) {
      await expect(page.getByTestId(`line-count-${id}`)).toHaveText(
        String(vehicles.filter((v) => v.routeId === id).length),
      );
    }
    const mapBox = await page.getByTestId("live-map").boundingBox();
    expect(mapBox!.height).toBeGreaterThanOrEqual(860 * 0.85);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      860,
    );
  });

  test("スマホでは凡例が閉じており、キーボードで開閉・切り替えできる", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForMap(page);
    const toggle = page.getByRole("button", { name: "Lines", exact: false });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("route-filter-Red")).toBeHidden();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const red = page.getByTestId("route-filter-Red");
    await red.focus();
    await page.keyboard.press("Space");
    await expect(red).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(red).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test("明暗を切り替えても路線の選択と最新の車両を保つ", async ({ page }) => {
    const styles: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/styles/")) styles.push(r.url());
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect.poll(() => styles.some((url) => url.endsWith("/dark"))).toBe(true);
    await waitForMap(page);
    await page.getByTestId("route-filter-Red").click();
    expect(
      (await vehicleFeatures(page)).filter((v) => v.isStale).every((v) => v.color === "#6c7a84"),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => styles.at(-1)).toContain("/positron");
    await waitForMap(page);
    expect((await vehicleFeatures(page)).length).toBe(106);
    expect(
      JSON.stringify(await page.evaluate(() => window.__mbtaMap?.getFilter("vehicles"))),
    ).not.toContain('"Red"');
    await expect(page.getByTestId("route-filter-Red")).toHaveAttribute("aria-pressed", "false");
  });

  test("ブラウザから MBTA API を呼ばない（TR-004）", async ({ page }) => {
    const mbtaRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname === "api-v3.mbta.com") mbtaRequests.push(request.url());
    });
    await page.goto("/");
    await waitForMap(page);
    expect(mbtaRequests).toEqual([]);
  });
});
