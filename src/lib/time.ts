// 時刻と運行日の計算。運行日の計算はこのファイルだけで行う（憲章の原則 V）。
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const BOSTON_TZ = "America/New_York";

/** 運行日の切り替わり時刻（ET の時）。この時刻より前は前日の運行日に属する */
export const SERVICE_DAY_START_HOUR = 3;

/** 運行日。`YYYY-MM-DD` 形式の文字列 */
export type ServiceDate = string;

const SERVICE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// MBTA の日時はオフセット付き（例: 2026-11-01T05:23:46-05:00）
const MBTA_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseServiceDate(serviceDate: ServiceDate): { year: number; month: number; day: number } {
  const m = SERVICE_DATE_RE.exec(serviceDate);
  if (!m) throw new Error(`運行日の形式が正しくありません: ${serviceDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 存在しない日付（2026-02-30 など）を弾く
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error(`存在しない日付です: ${serviceDate}`);
  }
  return { year, month, day };
}

/** 運行日の文字列として正しいか */
export function isServiceDate(value: string): value is ServiceDate {
  try {
    parseServiceDate(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * ある時刻が属する運行日を返す。
 * ET の壁時計で 03:00 より前なら前日の運行日。夏時間の切り替え（02:00 台）も正しく扱える。
 */
export function serviceDateOf(instant: Date): ServiceDate {
  const et = new TZDate(instant.getTime(), BOSTON_TZ);
  let year = et.getFullYear();
  let month = et.getMonth();
  let day = et.getDate();
  if (et.getHours() < SERVICE_DAY_START_HOUR) {
    const prev = new Date(Date.UTC(year, month, day - 1));
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth();
    day = prev.getUTCDate();
  }
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** 運行時間（監視で「車両 0 件」を異常とみなす時間帯）の始まり。ET の 05:30（分で表す） */
export const SERVICE_HOURS_START_MINUTES = 5 * 60 + 30;

/**
 * ET の壁時計で運行時間中（05:30〜24:00）か（004 FR-013 の「運行時間中の車両 0 件」の監視に使う）。
 * 00:00〜05:30 は運行時間外。
 */
export function isInServiceHours(instant: Date): boolean {
  const et = new TZDate(instant.getTime(), BOSTON_TZ);
  return et.getHours() * 60 + et.getMinutes() >= SERVICE_HOURS_START_MINUTES;
}

/** 前の運行日の集計の期限。ET の 05:00（aggregate は 04:30 に動く） */
export const AGGREGATE_DEADLINE_HOUR = 5;

/**
 * 前の運行日の集計の期限を過ぎているか（004 FR-013 の「05:00 ET 時点で前日分の集計が未完了」の監視に使う）。
 * 運行日の始まり（03:00 ET）から 05:00 ET までは、集計がまだ終わっていなくてよい。
 */
export function isAggregateDeadlinePassed(instant: Date): boolean {
  const hour = new TZDate(instant.getTime(), BOSTON_TZ).getHours();
  return !(hour >= SERVICE_DAY_START_HOUR && hour < AGGREGATE_DEADLINE_HOUR);
}

/** 運行日に日数を足す（負の数で引く） */
export function addServiceDays(serviceDate: ServiceDate, days: number): ServiceDate {
  const { year, month, day } = parseServiceDate(serviceDate);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 運行日の範囲 [start, end) を UTC の時刻で返す。ET の 03:00 から翌日の 03:00 まで。
 * 夏時間の切り替えを含む運行日は 23 時間または 25 時間になる。
 */
export function serviceDayRange(serviceDate: ServiceDate): { start: Date; end: Date } {
  const { year, month, day } = parseServiceDate(serviceDate);
  const start = new TZDate(year, month - 1, day, SERVICE_DAY_START_HOUR, 0, 0, BOSTON_TZ);
  const end = new TZDate(year, month - 1, day + 1, SERVICE_DAY_START_HOUR, 0, 0, BOSTON_TZ);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** 運行日を DB の date 列に入れる Date（UTC の 0 時）にする */
export function serviceDateToDbDate(serviceDate: ServiceDate): Date {
  const { year, month, day } = parseServiceDate(serviceDate);
  return new Date(Date.UTC(year, month - 1, day));
}

/** MBTA のオフセット付き日時文字列をパースする。形式が違えば例外 */
export function parseMbtaDateTime(value: string): Date {
  if (!MBTA_DATETIME_RE.test(value)) {
    throw new Error(`MBTA の日時の形式が正しくありません: ${value}`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`MBTA の日時をパースできません: ${value}`);
  return new Date(ms);
}

/** 表示用: ボストン時間で書式化する（date-fns の書式） */
export function formatInBoston(instant: Date, pattern: string): string {
  return format(new TZDate(instant.getTime(), BOSTON_TZ), pattern);
}

// ---- 003 分析で使う時間帯と曜日 ----

/** 運行日の時間帯（ET の時）の並び。運行日は 03:00 に始まるので 3, 4, …, 23, 0, 1, 2 */
export const SERVICE_DAY_HOURS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => (SERVICE_DAY_START_HOUR + i) % 24,
);

/** ある時刻の ET の時（0〜23）。夏時間が終わる日の 1 時台（2 回ある）はどちらも 1 */
export function bostonHourOf(instant: Date): number {
  return new TZDate(instant.getTime(), BOSTON_TZ).getHours();
}

/** 運行日の曜日（0 = 日曜 … 6 = 土曜）。運行日の日付そのものの曜日 */
export function dayOfWeekOf(serviceDate: ServiceDate): number {
  const { year, month, day } = parseServiceDate(serviceDate);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** 曜日種別（間隔の開きの基準に使う）。祝日は考えない（specs/003-analytics/research.md） */
export type DayType = "weekday" | "saturday" | "sunday";

export function dayTypeOf(serviceDate: ServiceDate): DayType {
  const dow = dayOfWeekOf(serviceDate);
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}
