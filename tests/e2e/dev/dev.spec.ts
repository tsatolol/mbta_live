// dev での E2E（TR-007）: 読み取りだけの短いテスト。データは実際に収集したものなので、件数は決め打ちしない
import { waitForMap, vehicleFeatures } from "../helpers/map";
import { expect, test } from "./fixtures";

test("地図に 8 路線と車両が出て、地図タイルが読み込まれる", async ({ page }) => {
  const tiles: { url: string; status: number }[] = [];
  page.on("response", (res) => {
    if (new URL(res.url()).hostname === "tiles.openfreemap.org") {
      tiles.push({ url: res.url(), status: res.status() });
    }
  });

  await page.goto("/");
  await waitForMap(page);

  const routeIds = await page.evaluate(() => {
    const data = window.__mbtaMap?.getSource("routes")?.serialize().data as {
      features: { properties: { routeId: string } }[];
    };
    return new Set(data.features.map((f) => f.properties.routeId)).size;
  });
  expect(routeIds).toBe(8);

  // 運行時間外は車両がなく、その表示が出る
  const outOfService = await page.getByTestId("out-of-service").isVisible();
  if (!outOfService) expect((await vehicleFeatures(page)).length).toBeGreaterThan(0);

  // OpenFreeMap のスタイルとベクタータイルが読み込まれた
  expect(tiles.some((t) => t.url.includes("/styles/") && t.status === 200)).toBe(true);
  expect(tiles.some((t) => /\.pbf(\?|$)/.test(t.url) && t.status === 200)).toBe(true);
  expect(await page.evaluate(() => window.__mbtaMap?.areTilesLoaded())).toBe(true);
});

test("駅の到着表示が出る", async ({ page }) => {
  await page.goto("/stations");
  await page.getByTestId("station-search").fill("Park Street");
  await page.getByTestId("station-group-Red").getByTestId("station-link-place-pktrm").click();
  await expect(page.getByTestId("station-name")).toHaveText("Park Street");
  await expect(page.getByTestId("direction-Red-0")).toBeVisible();
});

test("アラートの一覧が出る", async ({ page }) => {
  await page.goto("/alerts");
  // 見出しに件数が出れば、一覧の取得が終わっている（件数はそのときのアラートによる）
  await expect(page.getByTestId("active-alerts").locator("h2")).toHaveText(/^Active now\s*\d+$/);
  await expect(page.getByTestId("upcoming-alerts").locator("h2")).toHaveText(/^Upcoming\s*\d+$/);
});

test("稼働状況が出て、collector が動いている", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("job-collect").getByTestId("job-last-status")).not.toHaveText(
    "never run",
  );
  await expect(page.getByTestId("table-routes").getByTestId("table-rows")).toHaveText("8");
});

test("初回表示が 3 秒以内（SC-002。コールドスタートを除く）", async ({ page }) => {
  // 1 回目でコールドスタートを済ませる
  await page.goto("/");
  await expect(
    page.getByTestId("vehicle-count").or(page.getByTestId("out-of-service")),
  ).toBeVisible();

  // 2 回目: 新しいページで、移動を始めてから列車の数（または運行時間外の表示）が出るまで
  const fresh = await page.context().newPage();
  const started = Date.now();
  await fresh.goto("/");
  await expect(
    fresh.getByTestId("vehicle-count").or(fresh.getByTestId("out-of-service")),
  ).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "first-view-ms", description: String(elapsedMs) });
  console.log(`初回表示: ${elapsedMs} ms`);
  expect(elapsedMs).toBeLessThan(3_000);
});
