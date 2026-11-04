// 分析の E2E の補助: グラフの見た目ではなく、グラフに渡したデータ（ECharts の getOption()）を読む
import type { Page } from "@playwright/test";

export interface ChartData {
  categories: string[];
  series: { name: string; data: (number | null)[] }[];
}

/** グラフが描かれるまで待ち、x 軸のカテゴリと系列のデータを返す */
export async function chartData(page: Page, id: string): Promise<ChartData> {
  await page.getByTestId(`chart-${id}`).waitFor();
  await page.waitForFunction((chartId) => {
    const option = window.__mbtaCharts?.[chartId]?.getOption() as
      { series?: unknown[] } | undefined;
    return (option?.series?.length ?? 0) > 0;
  }, id);
  return page.evaluate((chartId) => {
    const option = window.__mbtaCharts![chartId]!.getOption() as {
      xAxis?: { data?: string[] }[];
      series: { name: string; data: (number | null)[] }[];
    };
    return {
      categories: option.xAxis?.[0]?.data ?? [],
      series: option.series.map((s) => ({ name: s.name, data: s.data })),
    };
  }, id);
}
