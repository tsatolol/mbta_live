// 曜日 × 時間帯のヒートマップ（003 US4）の集約。純粋関数。
// 曜日は運行日の曜日（運行日は ET 03:00 に始まるので、0〜2 時は前の日付の曜日になる）。
// 時間帯は運行日の時間帯の並び（3〜23, 0〜2）
import { dayOfWeekOf, SERVICE_DAY_HOURS, type ServiceDate } from "@/lib/time";

export const HEATMAP_METRICS = ["headway_p90", "prediction_abs_error", "alert_minutes"] as const;
export type HeatmapMetric = (typeof HEATMAP_METRICS)[number];

/** 行の並び: 月〜日（0 = 日曜 … 6 = 土曜） */
export const HEATMAP_DAYS_OF_WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  /** データがなければ null */
  value: number | null;
  /** 運行間隔・予測精度は件数、アラートは日数 */
  n: number;
}

/** 運行間隔・予測精度の行: (運行日, 時間帯) ごとの件数と、値 × 件数の合計 */
export interface WeightedHourRow {
  serviceDate: ServiceDate;
  hour: number;
  n: number;
  /** 値 × n の合計 */
  weightedSum: number;
}

/** アラートの行: (運行日, 時間帯) ごとの有効な分数 */
export interface MinutesHourRow {
  serviceDate: ServiceDate;
  hour: number;
  minutes: number;
}

function emptyGrid(): Map<string, { sum: number; n: number }> {
  return new Map();
}

const key = (dow: number, hour: number) => `${dow}|${hour}`;

function toCells(
  grid: Map<string, { sum: number; n: number }>,
  value: (c: { sum: number; n: number }) => number,
): HeatmapCell[] {
  return HEATMAP_DAYS_OF_WEEK.flatMap((dayOfWeek) =>
    SERVICE_DAY_HOURS.map((hour) => {
      const c = grid.get(key(dayOfWeek, hour));
      return c && c.n > 0
        ? { dayOfWeek, hour, value: value(c), n: c.n }
        : { dayOfWeek, hour, value: null, n: 0 };
    }),
  );
}

/** 件数で重み付けした平均（運行間隔 p90・予測の平均絶対誤差）。セルは月〜日 × 運行日の時間帯の順 */
export function weightedHeatmap(rows: readonly WeightedHourRow[]): HeatmapCell[] {
  const grid = emptyGrid();
  for (const r of rows) {
    if (r.n <= 0) continue;
    const k = key(dayOfWeekOf(r.serviceDate), r.hour);
    const c = grid.get(k) ?? { sum: 0, n: 0 };
    c.sum += r.weightedSum;
    c.n += r.n;
    grid.set(k, c);
  }
  return toCells(grid, (c) => c.sum / c.n);
}

/**
 * 日あたりの平均の分数（アラート）。分母は、その曜日・時間帯が範囲に含まれた日数
 * （days: 運行日ごとの、終わっている・始まっている時間帯。今日はまだ来ていない時間帯を含めない）。
 * 分数の行がない日も 0 分として数える
 */
export function minutesHeatmap(
  rows: readonly MinutesHourRow[],
  days: readonly { serviceDate: ServiceDate; hours: readonly number[] }[],
): HeatmapCell[] {
  const grid = emptyGrid();
  for (const d of days) {
    const dow = dayOfWeekOf(d.serviceDate);
    for (const hour of d.hours) {
      const k = key(dow, hour);
      const c = grid.get(k) ?? { sum: 0, n: 0 };
      c.n += 1;
      grid.set(k, c);
    }
  }
  const counted = new Set(days.flatMap((d) => d.hours.map((h) => `${d.serviceDate}|${h}`)));
  for (const r of rows) {
    if (!counted.has(`${r.serviceDate}|${r.hour}`)) continue;
    const c = grid.get(key(dayOfWeekOf(r.serviceDate), r.hour));
    if (c) c.sum += r.minutes;
  }
  return toCells(grid, (c) => c.sum / c.n);
}

/** 今日のうち、始まっている時間帯（運行日の並びで、今の時間帯まで） */
export function startedHours(currentHour: number): number[] {
  const i = SERVICE_DAY_HOURS.indexOf(currentHour);
  return SERVICE_DAY_HOURS.slice(0, i + 1);
}
