// 運行間隔（003 US1）の指標の TypeScript 版。純粋関数（specs/003-analytics/data-model.md の「運行間隔」）。
// 集計は SQL（src/lib/db/analytics-sql.ts）で行い、この関数とは小さなデータで結果を突き合わせる（TR-002）
import {
  BUNCHING_THRESHOLD_SEC,
  GAP_BASELINE_DAYS,
  GAP_MULTIPLIER,
  MAX_HEADWAY_SEC,
} from "./constants";
import { addServiceDays, bostonHourOf, dayTypeOf, type ServiceDate } from "@/lib/time";
import { appendTo } from "@/lib/collections";

/** Green の 4 支線（幹線では合算して route_id = Green でも計算する） */
export const GREEN_BRANCHES = ["Green-B", "Green-C", "Green-D", "Green-E"] as const;
export const GREEN_COMBINED = "Green";

/**
 * パーセンタイル（PostgreSQL の percentile_cont と同じ線形補間）。昇順に並べた値を渡す。空なら NaN
 */
export function percentileCont(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

export interface HeadwayArrival {
  routeId: string;
  directionId: number;
  /** 親駅 */
  stopId: string;
  arrivedAt: Date;
}

export interface HeadwayKey {
  routeId: string;
  directionId: number;
  stopId: string;
  hour: number;
}

export interface HeadwayStatRow extends HeadwayKey {
  n: number;
  meanSec: number;
  p50Sec: number;
  p90Sec: number;
  maxSec: number;
  bunchingCount: number;
  gapCount: number;
}

export function headwayKeyString(k: HeadwayKey): string {
  return `${k.routeId}|${k.directionId}|${k.stopId}|${k.hour}`;
}

/** 間隔の開きの基準（過去の p50 の中央値）を引く。なければ undefined */
export type GapBaselineLookup = (key: HeadwayKey) => number | undefined;

/**
 * 1 つの運行日の到着から、(路線, 方向, 駅, 時間帯) ごとの運行間隔の統計を作る。
 * - 同じ (路線, 方向, 駅) の到着を時刻の順に並べ、連続する到着の差を運行間隔とする（秒）
 * - MAX_HEADWAY_SEC より長い間隔（運休時間帯）は除く（ちょうどは含む）
 * - 時間帯は後の到着の ET の時
 * - Green の幹線の駅（greenTrunkStops）では、4 支線の到着をまとめた route_id = Green も作る
 * 行は (路線, 方向, 駅, 時間帯) の順
 */
export function headwayStats(
  arrivals: readonly HeadwayArrival[],
  options: { greenTrunkStops: ReadonlySet<string>; baseline?: GapBaselineLookup },
): HeadwayStatRow[] {
  const groups = new Map<string, HeadwayArrival[]>();
  const add = (routeId: string, a: HeadwayArrival) => {
    const key = `${routeId}|${a.directionId}|${a.stopId}`;
    const list = groups.get(key) ?? [];
    list.push({ ...a, routeId });
    groups.set(key, list);
  };
  for (const a of arrivals) {
    add(a.routeId, a);
    if (
      (GREEN_BRANCHES as readonly string[]).includes(a.routeId) &&
      options.greenTrunkStops.has(a.stopId)
    ) {
      add(GREEN_COMBINED, a);
    }
  }

  const byHour = new Map<string, { key: HeadwayKey; values: number[] }>();
  for (const list of groups.values()) {
    const sorted = [...list].sort((x, y) => x.arrivedAt.getTime() - y.arrivedAt.getTime());
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const sec = (cur.arrivedAt.getTime() - prev.arrivedAt.getTime()) / 1000;
      if (sec > MAX_HEADWAY_SEC) continue;
      const key: HeadwayKey = {
        routeId: cur.routeId,
        directionId: cur.directionId,
        stopId: cur.stopId,
        hour: bostonHourOf(cur.arrivedAt),
      };
      const k = headwayKeyString(key);
      const entry = byHour.get(k) ?? { key, values: [] };
      entry.values.push(sec);
      byHour.set(k, entry);
    }
  }

  const rows: HeadwayStatRow[] = [];
  for (const { key, values } of byHour.values()) {
    const sorted = [...values].sort((a, b) => a - b);
    const baseline = options.baseline?.(key);
    rows.push({
      ...key,
      n: sorted.length,
      meanSec: sorted.reduce((s, v) => s + v, 0) / sorted.length,
      p50Sec: percentileCont(sorted, 0.5),
      p90Sec: percentileCont(sorted, 0.9),
      maxSec: Math.round(sorted.at(-1)!),
      bunchingCount: sorted.filter((v) => v < BUNCHING_THRESHOLD_SEC).length,
      gapCount:
        baseline === undefined ? 0 : sorted.filter((v) => v > baseline * GAP_MULTIPLIER).length,
    });
  }
  return rows.sort(compareHeadwayKeys);
}

export function compareHeadwayKeys(a: HeadwayKey, b: HeadwayKey): number {
  return (
    a.routeId.localeCompare(b.routeId) ||
    a.directionId - b.directionId ||
    a.stopId.localeCompare(b.stopId) ||
    a.hour - b.hour
  );
}

export interface HistoricalHeadwayRow extends HeadwayKey {
  serviceDate: ServiceDate;
  p50Sec: number;
}

/**
 * 間隔の開きの基準: 対象の運行日より前の GAP_BASELINE_DAYS 日のうち、同じ曜日種別の日の
 * (路線, 方向, 駅, 時間帯) の p50 の中央値
 */
export function gapBaselines(
  history: readonly HistoricalHeadwayRow[],
  serviceDate: ServiceDate,
): GapBaselineLookup {
  const from = addServiceDays(serviceDate, -GAP_BASELINE_DAYS);
  const dayType = dayTypeOf(serviceDate);
  const values = new Map<string, number[]>();
  for (const h of history) {
    if (h.serviceDate < from || h.serviceDate >= serviceDate) continue;
    if (dayTypeOf(h.serviceDate) !== dayType) continue;
    const k = headwayKeyString(h);
    appendTo(values, k, h.p50Sec);
  }
  const medians = new Map(
    [...values].map(([k, v]) => [
      k,
      percentileCont(
        [...v].sort((a, b) => a - b),
        0.5,
      ),
    ]),
  );
  return (key) => medians.get(headwayKeyString(key));
}

export interface PatternForTrunk {
  routeId: string;
  canonical: boolean;
  typicality: number;
  stationIds: readonly string[];
}

/** Green の 2 つ以上の支線が通る親駅（幹線）。典型的な路線パターン（canonical か typicality 1）から求める */
export function greenTrunkStopsOf(patterns: readonly PatternForTrunk[]): Set<string> {
  const routesByStop = new Map<string, Set<string>>();
  for (const p of patterns) {
    if (!(GREEN_BRANCHES as readonly string[]).includes(p.routeId)) continue;
    if (!p.canonical && p.typicality !== 1) continue;
    for (const s of p.stationIds) {
      routesByStop.set(s, (routesByStop.get(s) ?? new Set()).add(p.routeId));
    }
  }
  return new Set([...routesByStop].filter(([, r]) => r.size >= 2).map(([s]) => s));
}

// ---- 集計の行をまとめる（分析 API と画面） ----

export interface HeadwayStatValues {
  n: number;
  meanSec: number;
  p50Sec: number;
  p90Sec: number;
  maxSec: number;
  bunchingCount: number;
  gapCount: number;
}

/**
 * 複数の (駅, 時間帯, 運行日) の統計を 1 つにまとめる。平均・件数・最大は正確。p50 / p90 は件数で
 * 重み付けした平均（元の間隔を持っていないので正確なパーセンタイルではない。画面に注記する）。空なら null
 */
export function combineHeadwayStats(rows: readonly HeadwayStatValues[]): HeadwayStatValues | null {
  const n = rows.reduce((s, r) => s + r.n, 0);
  if (n === 0) return null;
  const weighted = (f: (r: HeadwayStatValues) => number) =>
    rows.reduce((s, r) => s + f(r) * r.n, 0) / n;
  return {
    n,
    meanSec: weighted((r) => r.meanSec),
    p50Sec: weighted((r) => r.p50Sec),
    p90Sec: weighted((r) => r.p90Sec),
    maxSec: Math.max(...rows.map((r) => r.maxSec)),
    bunchingCount: rows.reduce((s, r) => s + r.bunchingCount, 0),
    gapCount: rows.reduce((s, r) => s + r.gapCount, 0),
  };
}

export interface DatedHeadwayStat extends HeadwayStatValues {
  serviceDate: ServiceDate;
  hour: number;
}

/** 運行日ごと（古い順）と時間帯ごと（運行日の時間帯の並び）にまとめる */
export function summarizeHeadways(
  rows: readonly DatedHeadwayStat[],
  hourOrder: readonly number[],
): {
  daily: (HeadwayStatValues & { serviceDate: ServiceDate })[];
  byHour: (HeadwayStatValues & { hour: number })[];
  totals: { n: number; bunchingCount: number; gapCount: number };
} {
  const group = <K>(key: (r: DatedHeadwayStat) => K) => {
    const m = new Map<K, DatedHeadwayStat[]>();
    for (const r of rows) appendTo(m, key(r), r);
    return m;
  };
  const byDate = group((r) => r.serviceDate);
  const byHourMap = group((r) => r.hour);
  return {
    daily: [...byDate.keys()].sort().flatMap((serviceDate) => {
      const c = combineHeadwayStats(byDate.get(serviceDate) ?? []);
      return c ? [{ serviceDate, ...c }] : [];
    }),
    byHour: hourOrder.flatMap((hour) => {
      const c = combineHeadwayStats(byHourMap.get(hour) ?? []);
      return c ? [{ hour, ...c }] : [];
    }),
    totals: {
      n: rows.reduce((s, r) => s + r.n, 0),
      bunchingCount: rows.reduce((s, r) => s + r.bunchingCount, 0),
      gapCount: rows.reduce((s, r) => s + r.gapCount, 0),
    },
  };
}
