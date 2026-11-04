// グラフの共通の見た目（dataviz の参照パレット。画面は明るい背景だけなので light の値）。
// 系列の色は決まった順に割り当て、色だけで区別させない（系列が 2 つ以上なら凡例を出す）
import type { EChartOption } from "./echart";

/** 系列の色（決まった順。白い背景で色覚の差と対比を検証済み: 1 と 2） */
export const SERIES_COLORS = [
  "#2a78d6", // 青
  "#eb6834", // 橙
  "#1baf7a", // 緑青
  "#eda100", // 黄
] as const;

export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
} as const;

/** 数値の連続量（ヒートマップ）の 1 色の段階（青、明るい → 暗い） */
export const SEQUENTIAL_BLUE = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
] as const;

const axisCommon = {
  axisLine: { lineStyle: { color: INK.axis } },
  axisTick: { show: false },
  axisLabel: { color: INK.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: INK.grid, width: 1 } },
  nameTextStyle: { color: INK.muted, fontSize: 11 },
};

/** カテゴリの x 軸 + 数値の y 軸のグラフの土台（凡例は上、十字線のツールチップ） */
export function baseCartesian(options: {
  categories: readonly string[];
  legend: boolean;
  tooltipTrigger?: "axis" | "item";
}): EChartOption {
  return {
    animation: false,
    textStyle: { color: INK.secondary, fontFamily: "inherit" },
    grid: { left: 48, right: 16, top: options.legend ? 36 : 16, bottom: 32, containLabel: false },
    legend: options.legend
      ? {
          top: 0,
          left: 0,
          icon: "roundRect",
          itemWidth: 12,
          itemHeight: 8,
          textStyle: { color: INK.secondary },
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
    itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
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
