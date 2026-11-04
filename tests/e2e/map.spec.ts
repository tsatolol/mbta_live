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
    for (const v of stale) expect(v.color).toBe("#9ca3af");
    for (const v of vehicles.filter((x) => !x.isStale)) expect(v.color).not.toBe("#9ca3af");
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
