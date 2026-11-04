// 002 TR-003: 駅の一覧と到着表示（US2）
import { expect, test } from "@playwright/test";
import { tripIdsAt } from "./helpers/db";
import { E2E_FIXTURES } from "./helpers/scenario";
import { seedE2e } from "./helpers/seed";

/** m:ss を秒にする */
function seconds(clock: string | null): number {
  const [m, s] = (clock ?? "").split(":").map(Number);
  return (m ?? NaN) * 60 + (s ?? NaN);
}

test.describe("駅", () => {
  test.beforeEach(() => {
    seedE2e("base");
  });

  test("駅名で検索すると、該当する駅が路線ごとにまとまって出る", async ({ page }) => {
    await page.goto("/stations");
    await expect(page.getByTestId("station-group-Red")).toBeVisible();
    await expect(page.locator('[data-testid^="station-group-"]')).toHaveCount(8);

    await page.getByTestId("station-search").fill("park st");
    // Park Street は Red と Green の 4 支線を通る
    await expect(page.locator('[data-testid^="station-group-"]')).toHaveCount(5);
    for (const route of ["Red", "Green-B", "Green-C", "Green-D", "Green-E"]) {
      await expect(
        page.getByTestId(`station-group-${route}`).getByTestId("station-link-place-pktrm"),
      ).toHaveText("Park Street");
    }

    await page.getByTestId("station-search").fill("no such station");
    await expect(page.getByTestId("no-stations")).toBeVisible();
  });

  test("駅を選ぶと、方向ごとに次の 3 本が n min で出る", async ({ page }) => {
    await page.goto("/stations");
    await page.getByTestId("station-search").fill("Park Street");
    await page.getByTestId("station-group-Red").getByTestId("station-link-place-pktrm").click();
    await expect(page).toHaveURL(/\/stations\/place-pktrm$/);
    await expect(page.getByTestId("station-name")).toHaveText("Park Street");

    const red = page.getByTestId("direction-Red-0");
    await expect(red).toContainText("Ashmont/Braintree");
    const arrivals = red.getByTestId("arrival");
    await expect(arrivals.first()).toBeVisible();
    expect(await arrivals.count()).toBeLessThanOrEqual(3);
    for (const countdown of await red.getByTestId("arrival-countdown").all()) {
      await expect(countdown).toHaveText(/^(\d+ min|< 1 min)$/);
    }
  });

  test("ページを再読み込みしなくても毎秒カウントダウンする", async ({ page }) => {
    await page.clock.install();
    await page.goto(`/stations/${E2E_FIXTURES.station}`);
    // 1 分以上先の便（n min が 1 分で 1 減ることを確かめる）
    const target = page
      .getByTestId("arrival")
      .filter({ has: page.getByTestId("arrival-countdown").getByText(/^([2-9]|\d{2,}) min$/) })
      .first();
    await expect(target).toBeVisible();
    const tripId = await target.getAttribute("data-trip-id");
    const row = page.locator(`[data-testid="arrival"][data-trip-id="${tripId}"]`).first();

    await page.clock.pauseAt(new Date(Date.now() + 1_000));
    const before = seconds(await row.getByTestId("arrival-clock").textContent());
    const beforeMin = Number.parseInt((await row.getByTestId("arrival-countdown").textContent())!);

    await page.clock.runFor(5_000);
    await expect
      .poll(async () => seconds(await row.getByTestId("arrival-clock").textContent()))
      .toBe(before - 5);

    await page.clock.runFor(60_000);
    await expect(row.getByTestId("arrival-countdown")).toHaveText(`${beforeMin - 1} min`);
  });

  test("運休の便は Cancelled と出て、通過（SKIPPED）の便は出ない", async ({ page }) => {
    const [cancelled] = await tripIdsAt(E2E_FIXTURES.station, "CANCELLED");
    const skipped = await tripIdsAt(E2E_FIXTURES.station, "SKIPPED");
    expect(cancelled).toBeDefined();
    expect(skipped.length).toBeGreaterThan(0);

    await page.goto(`/stations/${E2E_FIXTURES.station}`);
    const row = page.locator(`[data-testid="arrival"][data-trip-id="${cancelled}"]`);
    await expect(row).toHaveAttribute("data-cancelled", "true");
    await expect(row.getByTestId("arrival-cancelled")).toHaveText("Cancelled");
    await expect(row.getByTestId("arrival-countdown")).toHaveCount(0);
    for (const trip of skipped) {
      await expect(page.locator(`[data-testid="arrival"][data-trip-id="${trip}"]`)).toHaveCount(0);
    }
  });

  test("その駅と路線に有効なアラートが出る", async ({ page }) => {
    await page.goto(`/stations/${E2E_FIXTURES.alertStation}`);
    await expect(page.getByTestId("station-name")).toHaveText("Jackson Square");
    const alerts = page.getByTestId("station-alert");
    await expect(alerts).toHaveCount(2);
    await expect(alerts.first()).toContainText("Station Issue");
  });

  test("存在しない駅は Station not found と出る", async ({ page }) => {
    await page.goto("/stations/place-nowhere");
    await expect(page.getByTestId("station-not-found")).toBeVisible();
  });
});
