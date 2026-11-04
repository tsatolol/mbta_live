// 003 TR-005: 分析の画面。analytics シナリオ（前の 7 日を集計済み + 今日の今まで）を使う。
// 今日の分は実行する時刻によって量が変わるので、件数や値は過去の日で確かめる
import { expect, test } from "@playwright/test";
import { chartData } from "./helpers/charts";
import { seedE2e } from "./helpers/seed";

test.describe("分析: 運行間隔", () => {
  test.beforeAll(() => {
    seedE2e("analytics");
  });

  test("Analytics から運行間隔の画面が開き、推移・分布・件数と注記が出る", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/\/analytics\/headways/);
    await expect(page.getByTestId("analytics-tab-headways")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("filter-route")).toHaveValue("Red");

    const trend = await chartData(page, "headway-trend");
    // 過去の 6 日（と、今日の分があれば今日）
    expect(trend.categories.length).toBeGreaterThanOrEqual(6);
    const [p50, p90] = trend.series;
    expect(p50!.name).toBe("Median (p50)");
    // テスト用データの Red は 6 分ごと（過去の日）
    for (const v of p50!.data.slice(0, 6)) expect(v).toBeCloseTo(6, 0);
    expect(p90!.data.length).toBe(p50!.data.length);

    const byHour = await chartData(page, "headway-by-hour");
    expect(byHour.categories[0]).toBe("5:00");
    // 14 時台は間隔の開き（18 分）があるので p90 が大きい
    const i14 = byHour.categories.indexOf("14:00");
    expect(byHour.series[1]!.data[i14]!).toBeGreaterThan(byHour.series[1]!.data[0]!);

    const incidents = await chartData(page, "headway-incidents");
    expect(incidents.series.map((s) => s.name)).toEqual([
      "Bunching (< 2 min)",
      "Gaps (> 2× usual)",
    ]);
    await expect(page.getByTestId("stat-bunching-value")).not.toHaveText("0");
    await expect(page.getByTestId("stat-gaps-value")).not.toHaveText("0");

    await expect(page.getByTestId("precision-note")).toContainText("±60 seconds");
    await expect(page.getByTestId("aggregation-note")).toContainText(
      "Daily statistics are available",
    );
  });

  test("Green（全支線）を選ぶと、幹線の駅で支線を合算した間隔になる", async ({ page }) => {
    await page.goto("/analytics/headways");
    await page.getByTestId("filter-route").selectOption("Green");
    await expect(page).toHaveURL(/route=Green/);
    await expect(page.getByTestId("filter-stop").locator("option")).toHaveText([
      "All stations",
      "Boylston",
      "Park Street",
    ]);
    const trend = await chartData(page, "headway-trend");
    // 4 支線を合算すると 3 分ごと
    for (const v of trend.series[0]!.data.slice(0, 6)) expect(v).toBeCloseTo(3, 0);
  });

  test("駅で絞り込むと、件数がその駅の分になる。絞り込みは URL に残る", async ({ page }) => {
    await page.goto("/analytics/headways?route=Red&direction=0");
    const all = Number(
      (await page.getByTestId("stat-headways-value").textContent())!.replace(/,/g, ""),
    );
    await page.getByTestId("filter-stop").selectOption({ label: "Harvard" });
    await expect(page).toHaveURL(/stop=place-harsq/);
    await expect
      .poll(async () =>
        Number((await page.getByTestId("stat-headways-value").textContent())!.replace(/,/g, "")),
      )
      .toBeLessThan(all);

    // ほかのタブに移っても、期間と路線は引き継ぐ
    await page.getByTestId("filter-route").selectOption("Orange");
    await page.getByTestId("analytics-tab-predictions").click();
    await expect(page).toHaveURL(/\/analytics\/predictions\?.*route=Orange/);
  });

  test("データのない絞り込みでは、データがないと出る", async ({ page }) => {
    await page.goto("/analytics/headways?route=Red&from=2026-01-01&to=2026-01-07");
    await expect(page.getByTestId("analytics-empty")).toBeVisible();
    await expect(page.getByTestId("stat-headways-value")).toHaveText("0");
  });
});

test.describe("分析: 予測精度", () => {
  test.beforeAll(() => {
    seedE2e("analytics");
  });

  test("リード時間ごとの誤差と ±60 秒以内の割合、合計の数値が出る", async ({ page }) => {
    await page.goto("/analytics/predictions");
    await expect(page.getByTestId("analytics-tab-predictions")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const byLead = await chartData(page, "prediction-error-by-lead");
    expect(byLead.categories).toEqual(["1 min", "3 min", "5 min", "10 min", "15 min"]);
    // テスト用データの誤差は「リード時間 × 10 秒」
    expect(byLead.series[0]!.data).toEqual([10, 30, 50, 100, 150]);

    const within = await chartData(page, "prediction-within-by-lead");
    expect(within.series[0]!.data).toEqual([100, 100, 100, 0, 0]);

    const trend = await chartData(page, "prediction-trend");
    expect(trend.categories.length).toBeGreaterThanOrEqual(6);

    await expect(page.getByTestId("stat-within-value")).toHaveText("60%");
    await expect(page.getByTestId("precision-note")).toBeVisible();
  });

  test("予測の種類で絞り込むと、その種類だけの精度になる", async ({ page }) => {
    await page.goto("/analytics/predictions");
    await expect(page.getByTestId("stat-bias-value")).toHaveText(/^(0 s|[+-]\d+ s)/);
    await page.getByTestId("filter-update-type").selectOption("AT_TERMINAL");
    await expect(page).toHaveURL(/updateType=AT_TERMINAL/);
    // テスト用データの AT_TERMINAL は偶数の便だけで、誤差はすべて正（予測より遅く到着）
    await expect(page.getByTestId("stat-bias-value")).toHaveText(/^\+\d+ s \(late\)$/);
  });
});
