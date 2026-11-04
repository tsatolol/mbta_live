"use client";
// Apache ECharts を包む部品: ブラウザでだけ描画し、親の幅の変化に合わせて大きさを変える。
// 使うグラフと部品だけを echarts/core に登録する（バンドルを小さくするため）。
// E2E はグラフの見た目ではなく、window.__mbtaCharts[id] の getOption() で渡したデータを確かめる
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EChartOption = echarts.EChartsCoreOption;

declare global {
  interface Window {
    /** E2E でグラフに渡したデータを確かめるため（id → インスタンス） */
    __mbtaCharts?: Record<string, echarts.ECharts>;
  }
}

export function EChart({
  id,
  option,
  height = 320,
  ariaLabel,
}: {
  /** E2E とアクセシビリティ用の識別子 */
  id: string;
  option: EChartOption;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    window.__mbtaCharts = { ...window.__mbtaCharts, [id]: chart };
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
      if (window.__mbtaCharts) delete window.__mbtaCharts[id];
    };
  }, [id]);

  useEffect(() => {
    // データが変わったら置き換える（前の系列を残さない）
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      data-testid={`chart-${id}`}
      style={{ height }}
      className="w-full"
    />
  );
}
