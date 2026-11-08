// 002 TR-003: 駅の一覧と到着表示（US2）
import { expect, test, type Page } from "@playwright/test";
import type { PredictionsResponse } from "@/lib/api-schemas/predictions";
import { tripIdsAt } from "./helpers/db";
import { E2E_FIXTURES } from "./helpers/scenario";
import { seedE2e } from "./helpers/seed";

// 通常の導線は PostgreSQL の記録済みデータ、時刻境界だけ内部 API の固定応答で検証する。
async function interceptBoard(page: Page, update: (board: PredictionsResponse) => void) {
  const response = await page.request.get(`/api/live/predictions?stop=${E2E_FIXTURES.station}`);
  expect(response.ok()).toBe(true);
  const source: PredictionsResponse = await response.json();
  await page.route("**/api/live/predictions?*", async (route) => {
    const board = structuredClone(source);
    update(board);
    await route.fulfill({ json: board });
  });
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

  test("駅を選ぶと、方向ごとに次の 3 本が発車標に出る", async ({ page }) => {
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
      await expect(countdown).toHaveText(/^(\d+ min|\d+:\d{2}|Now)$/);
    }
  });

  test("残り時間は各便に一つで、毎秒減り、時刻を迎えた便は次回取得まで Now と出る", async ({
    page,
  }) => {
    const start = new Date("2026-11-02T15:20:00Z");
    let snapshot = start;
    await page.clock.install({ time: new Date(start.getTime() - 60_000) });
    await interceptBoard(page, (board) => {
      board.generatedAt = snapshot.toISOString();
      const group = board.directions[0]!;
      const template = group.arrivals[0]!;
      group.arrivals = [1, 83, 180].map((seconds) => ({
        ...template,
        tripId: `clock-${seconds}`,
        time: new Date(start.getTime() + seconds * 1_000).toISOString(),
        cancelled: false,
      }));
      board.directions = [group];
    });
    await page.goto(`/stations/${E2E_FIXTURES.station}`);
    const count = (seconds: number) =>
      page.locator(`[data-trip-id="clock-${seconds}"]`).getByTestId("arrival-countdown");
    await expect(count(180)).toBeVisible();
    await page.clock.pauseAt(start);
    await expect(count(180)).toHaveText("3 min");
    await expect(count(83)).toHaveText("1:23");
    await expect(page.getByTestId("arrival-countdown")).toHaveCount(3);
    await expect(page.getByTestId("arrival-clock")).toHaveCount(0);

    await page.clock.runFor(2_000);
    await expect(count(180)).toHaveText("2 min");
    await expect(count(83)).toHaveText("1:21");
    await expect(count(1)).toHaveText("Now");
    await page.clock.runFor(4_000);
    await expect(count(83)).toHaveText("1:17");
    await expect(count(1)).toHaveText("Now");

    snapshot = new Date(start.getTime() + 30_000);
    const refreshed = page.waitForResponse(
      async (response) =>
        response.url().includes("/api/live/predictions?") &&
        (await response.json()).generatedAt === snapshot.toISOString(),
    );
    await page.clock.runFor(31_000);
    await refreshed;
    // TanStack Query の通知タイマーも、停止中の仮想時計で処理する。
    await page.clock.runFor(1);
    await expect(page.locator('[data-trip-id="clock-1"]')).toHaveCount(0);
    await expect(count(83)).toHaveText("0:46");
    await page.clock.runFor(24_000);
    await expect(count(180)).toHaveText("1:59");
  });

  test("取得時点で過ぎた便を除外し、始発駅の departs と空の方向を表示する", async ({ page }) => {
    const now = new Date("2026-11-02T15:20:00Z");
    await page.clock.install({ time: new Date(now.getTime() - 60_000) });
    await interceptBoard(page, (board) => {
      board.generatedAt = now.toISOString();
      const group = board.directions[0]!;
      group.arrivals = [-1, 0, 60].map((seconds) => ({
        ...group.arrivals[0]!,
        tripId: `past-${seconds}`,
        time: new Date(now.getTime() + seconds * 1_000).toISOString(),
        timeKind: "departure",
        cancelled: false,
      }));
      board.directions = [group, { ...group, directionId: 1, arrivals: [] }];
    });
    await page.goto(`/stations/${E2E_FIXTURES.station}`);
    await expect(page.getByTestId("departure-board")).toBeVisible();
    await page.clock.pauseAt(now);
    await expect(page.getByTestId("arrival")).toHaveCount(1);
    const row = page.getByTestId("arrival");
    await expect(row.getByTestId("arrival-countdown")).toHaveText("1:00");
    await expect(row).toContainText("departs 10:21 AM");
    await expect(page.getByTestId("no-arrivals")).toHaveText("No upcoming trains");
  });

  for (const width of [320, 390, 1280]) {
    test(`幅 ${width}px でも長い駅名・行先が収まり、残り時間が最も大きい文字で出る`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 860 });
      await interceptBoard(page, (board) => {
        board.stop.name = "Massachusetts Avenue / ALongStationNameWithoutSpaces";
        board.directions[0]!.destination = "Ashmont / Braintree / ALongDestinationWithoutSpaces";
        board.directions[0]!.arrivals = board.directions[0]!.arrivals.map((arrival, i) => ({
          ...arrival,
          time: new Date(Date.now() + (10 + i * 10) * 60_000).toISOString(),
          cancelled: false,
        }));
      });
      await page.goto(`/stations/${E2E_FIXTURES.station}`);
      await expect(page.getByTestId("arrival-countdown").first()).toBeVisible();
      const measurements = await page.getByTestId("departure-board").evaluate((board) => {
        const countdowns = [...board.querySelectorAll('[data-testid="arrival-countdown"]')];
        const size = (element: Element) => parseFloat(getComputedStyle(element).fontSize);
        const countdownSize = Math.max(...countdowns.map(size));
        const main = document.querySelector("main")!;
        const otherSizes = [...main.querySelectorAll("*")]
          .filter((el) =>
            [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()),
          )
          .map(size);
        return {
          countdownSize,
          largestOther: Math.max(...otherSizes),
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          clipped: countdowns.some((el) => el.scrollWidth > el.clientWidth),
        };
      });
      expect(measurements.countdownSize).toBeGreaterThanOrEqual(measurements.largestOther);
      expect(measurements.scrollWidth).toBe(measurements.width);
      expect(measurements.clipped).toBe(false);
    });
  }

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
    await expect(row.locator("time")).toHaveCSS("text-decoration-line", "line-through");
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
    await expect(alerts.first()).toContainText("Notice");
  });

  test("Disruption は縞と警告で示し、発車標の前に出す", async ({ page }) => {
    await interceptBoard(page, (board) => {
      // 遅延の見た目は、内部 API の固定応答で再現する。
      board.alerts = [
        {
          id: "design-delay",
          effect: "DELAY",
          cause: "UNKNOWN_CAUSE",
          severity: 7,
          header: "Red Line delays",
          shortHeader: null,
          description: "Delays",
          serviceEffect: null,
          timeframe: null,
          lifecycle: "NEW",
          status: "active",
          activePeriod: [],
          routeIds: ["Red"],
          inFeed: true,
          updatedAt: board.generatedAt,
        },
      ];
    });
    await page.goto(`/stations/${E2E_FIXTURES.station}`);
    const alert = page.getByTestId("station-alert");
    await expect(alert).toContainText("Disruption");
    await expect(alert.locator(".stale-stripes")).toBeVisible();
    await expect(alert.locator("svg")).toBeVisible();
    const positions = await page.evaluate(() => ({
      alert: document.querySelector('[data-testid="station-alerts"]')!.getBoundingClientRect()
        .bottom,
      board: document.querySelector('[data-testid="departure-board"]')!.getBoundingClientRect().top,
    }));
    expect(positions.alert).toBeLessThanOrEqual(positions.board);
  });

  test("存在しない駅は Station not found と出る", async ({ page }) => {
    await page.goto("/stations/place-nowhere");
    await expect(page.getByTestId("station-not-found")).toBeVisible();
    await page.getByTestId("station-not-found").getByRole("link").click();
    await expect(page).toHaveURL(/\/stations$/);
  });
});
