// グラフの共通の見た目（dataviz の参照パレット）。色は CSS 変数の参照（"var(--chart-1)" など）で書き、
// グラフの部品（echart.tsx）が描く直前に、いまの表示（明るい / 暗い）の値に置き換える。
// 値の正は specs/005-ui-design/contracts/design-tokens.md（src/app/globals.css）。
// 系列の色は決まった順に割り当て、色だけで区別させない（系列が 2 つ以上なら凡例を出す）
import type { EChartOption } from "./echart";

/** 系列の色（決まった順。明るい・暗いの両方で色覚の差と対比を検証済み: 1 と 2） */
export const SERIES_COLORS = [
  "var(--chart-1)", // 青
  "var(--chart-2)", // 橙
  "var(--chart-3)", // 緑青
  "var(--chart-4)", // 黄
] as const;

export const INK = {
  primary: "var(--ink)",
  secondary: "var(--ink-muted)",
  muted: "var(--ink-muted)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  /** 印の縁（背景と同じ色。重なった印の間に隙間を見せる） */
  surface: "var(--panel)",
} as const;

/** 数値の連続量（ヒートマップ）の 1 色の段階（小さい → 大きい）。暗い表示では明るいほど大きい */
export const SEQUENTIAL_BLUE = [
  "var(--seq-1)",
  "var(--seq-2)",
  "var(--seq-3)",
  "var(--seq-4)",
  "var(--seq-5)",
  "var(--seq-6)",
  "var(--seq-7)",
] as const;

const axisCommon = {
  axisLine: { lineStyle: { color: INK.axis } },
  axisTick: { show: false },
  axisLabel: { color: INK.muted, fontSize: 13 },
  splitLine: { lineStyle: { color: INK.grid, width: 1 } },
  nameTextStyle: { color: INK.muted, fontSize: 13 },
};

/** カテゴリの x 軸 + 数値の y 軸のグラフの土台（凡例は上、十字線のツールチップ） */
export function baseCartesian(options: {
  categories: readonly string[];
  legend: boolean;
  tooltipTrigger?: "axis" | "item";
}): EChartOption {
  return {
    animation: false,
    textStyle: { color: INK.secondary, fontSize: 13 },
    grid: { left: 48, right: 16, top: options.legend ? 36 : 16, bottom: 32, containLabel: false },
    legend: options.legend
      ? {
          top: 0,
          left: 0,
          icon: "roundRect",
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { color: INK.secondary, fontSize: 13 },
        }
      : { show: false },
    tooltip: {
      trigger: options.tooltipTrigger ?? "axis",
      axisPointer: {
        type: options.tooltipTrigger === "item" ? "none" : "line",
        lineStyle: { color: INK.axis },
      },
    },
    xAxis: {
      type: "category",
      data: [...options.categories],
      ...axisCommon,
      splitLine: { show: false },
    },
    // 単位は軸の名前ではなく、グラフの見出しに書く（軸の名前は凡例と重なるため）
    yAxis: { type: "value", ...axisCommon },
  };
}

/** 折れ線の系列（2px、8px のマーカー） */
export function lineSeries(name: string, data: readonly (number | null)[], colorIndex: number) {
  return {
    type: "line" as const,
    name,
    data: [...data],
    color: SERIES_COLORS[colorIndex],
    lineStyle: { width: 2 },
    symbol: "circle",
    symbolSize: 8,
    itemStyle: { borderColor: INK.surface, borderWidth: 2 },
    connectNulls: false,
  };
}

/** 棒の系列（細め、データの端を 4px 丸める、棒の間に 2px の隙間） */
export function barSeries(name: string, data: readonly (number | null)[], colorIndex: number) {
  return {
    type: "bar" as const,
    name,
    data: [...data],
    color: SERIES_COLORS[colorIndex],
    barMaxWidth: 16,
    barGap: "15%",
    itemStyle: { borderRadius: [4, 4, 0, 0] },
  };
}

/** 秒 → 分（小数 1 桁） */
export function secToMin(sec: number): number {
  return Math.round((sec / 60) * 10) / 10;
}

/** 時間帯の表示（"5:00"） */
export function hourLabel(hour: number): string {
  return `${hour}:00`;
}

/** 件数のグラフ: y 軸の目盛りを整数だけにする */
export function integerYAxis(option: EChartOption): EChartOption {
  return { ...option, yAxis: { ...(option.yAxis as object), minInterval: 1 } };
}
