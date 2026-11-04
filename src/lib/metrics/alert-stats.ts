// アラートの傾向（003 US3）の集計の TypeScript 版。純粋関数（specs/003-analytics/data-model.md の「アラート」）。
// 集計は SQL（src/lib/db/analytics-sql.ts）で行い、この関数とは小さなデータで結果を突き合わせる（TR-002）。
//
// 運行日の各分（運行日の始まりから 1 分ごとの時刻 t）について、アラートが「有効」かを見る:
//   active_period のどれかに入る（start ≤ t < end。end がなければ終わりなし）
//   かつ、フィードで観測されていた（first_seen_at ≤ t ≤ last_seen_at）
// 有効な分が 1 分以上ある日だけ数える（予告だけの日は数えない）
import { DISRUPTION_EFFECTS } from "./constants";
import { bostonHourOf, serviceDayRange, type ServiceDate } from "@/lib/time";

/** 路線をまとめた行の route_id（複数の路線に関係するアラートを 1 回だけ数える） */
export const ALL_ROUTES = "All";

export type AlertCategory = "disruption" | "notice";

/** 遅延系（DELAY, SUSPENSION, SHUTTLE, STATION_CLOSURE）とお知らせ系（それ以外すべて） */
export function alertCategoryOf(effect: string): AlertCategory {
  return (DISRUPTION_EFFECTS as readonly string[]).includes(effect) ? "disruption" : "notice";
}

export interface AlertForStats {
  id: string;
  effect: string;
  cause: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  activePeriod: readonly { start: Date; end: Date | null }[];
  /** 関係する路線（alert_routes）。空なら集計しない */
  routeIds: readonly string[];
}

export interface DailyAlertStatRow {
  routeId: string;
  effect: string;
  cause: string;
  alertCount: number;
  /** アラートごとの有効な分数の合計 */
  activeMinutes: number;
}

export interface HourlyAlertMinuteRow {
  routeId: string;
  hour: number;
  category: AlertCategory;
  /** その時間帯に、その区分のアラートが 1 件以上有効だった分数（同時に 2 件あっても 1 分） */
  activeMinutes: number;
}

const MINUTE = 60_000;

/** 運行日の各分の始まりの時刻（夏時間の切り替え日は 1,380 / 1,500 分） */
export function serviceDayMinutes(serviceDate: ServiceDate): Date[] {
  const { start, end } = serviceDayRange(serviceDate);
  const out: Date[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += MINUTE) out.push(new Date(t));
  return out;
}

/** アラートがその時刻に有効か */
export function isAlertActiveAt(alert: AlertForStats, t: Date): boolean {
  const ms = t.getTime();
  if (ms < alert.firstSeenAt.getTime() || ms > alert.lastSeenAt.getTime()) return false;
  return alert.activePeriod.some(
    (p) => p.start.getTime() <= ms && (p.end === null || ms < p.end.getTime()),
  );
}

/** 1 つの運行日のアラートの集計（路線ごとと、路線をまとめた ALL_ROUTES） */
export function alertDayStats(
  alerts: readonly AlertForStats[],
  serviceDate: ServiceDate,
): { daily: DailyAlertStatRow[]; hourly: HourlyAlertMinuteRow[] } {
  const minutes = serviceDayMinutes(serviceDate);
  const daily = new Map<string, DailyAlertStatRow>();
  const hourly = new Map<string, { row: HourlyAlertMinuteRow; minutes: Set<number> }>();

  for (const alert of alerts) {
    if (alert.routeIds.length === 0) continue;
    const active = minutes.filter((t) => isAlertActiveAt(alert, t));
    if (active.length === 0) continue;
    const category = alertCategoryOf(alert.effect);
    for (const routeId of [...new Set(alert.routeIds), ALL_ROUTES]) {
      const dk = `${routeId}|${alert.effect}|${alert.cause}`;
      const d = daily.get(dk) ?? {
        routeId,
        effect: alert.effect,
        cause: alert.cause,
        alertCount: 0,
        activeMinutes: 0,
      };
      d.alertCount += 1;
      d.activeMinutes += active.length;
      daily.set(dk, d);
      for (const t of active) {
        const hour = bostonHourOf(t);
        const hk = `${routeId}|${hour}|${category}`;
        const h = hourly.get(hk) ?? {
          row: { routeId, hour, category, activeMinutes: 0 },
          minutes: new Set<number>(),
        };
        h.minutes.add(t.getTime());
        hourly.set(hk, h);
      }
    }
  }
  const byKey =
    <T>(key: (r: T) => string) =>
    (a: T, b: T) =>
      key(a) < key(b) ? -1 : 1;
  return {
    daily: [...daily.values()].sort(byKey((r) => `${r.routeId}|${r.effect}|${r.cause}`)),
    hourly: [...hourly.values()]
      .map(({ row, minutes: m }) => ({ ...row, activeMinutes: m.size }))
      .sort(byKey((r) => `${r.routeId}|${String(r.hour).padStart(2, "0")}|${r.category}`)),
  };
}

// ---- 集計の行をまとめる（分析 API） ----

export interface AlertAmount {
  alertCount: number;
  activeMinutes: number;
}

export interface DatedAlertStat extends AlertAmount {
  serviceDate: ServiceDate;
  effect: string;
  cause: string;
}

const zero = (): AlertAmount => ({ alertCount: 0, activeMinutes: 0 });
const add = (a: AlertAmount, b: AlertAmount): AlertAmount => ({
  alertCount: a.alertCount + b.alertCount,
  activeMinutes: a.activeMinutes + b.activeMinutes,
});

/**
 * 日別（dates の順。行がなければ 0）、effect ごと・cause ごと（分数の多い順、同じなら名前の順）、
 * 区分ごとの合計にまとめる
 */
export function summarizeAlertStats(
  rows: readonly DatedAlertStat[],
  dates: readonly ServiceDate[],
) {
  const daily = new Map(
    dates.map((d) => [
      d,
      { disruption: zero(), notice: zero() } as Record<AlertCategory, AlertAmount>,
    ]),
  );
  const byEffect = new Map<string, AlertAmount>();
  const byCause = new Map<string, AlertAmount>();
  const totals: Record<AlertCategory, AlertAmount> = { disruption: zero(), notice: zero() };
  for (const r of rows) {
    const category = alertCategoryOf(r.effect);
    const day = daily.get(r.serviceDate);
    if (day) day[category] = add(day[category], r);
    byEffect.set(r.effect, add(byEffect.get(r.effect) ?? zero(), r));
    byCause.set(r.cause, add(byCause.get(r.cause) ?? zero(), r));
    totals[category] = add(totals[category], r);
  }
  const ranked = (m: Map<string, AlertAmount>) =>
    [...m].sort(
      ([ka, a], [kb, b]) => b.activeMinutes - a.activeMinutes || (ka < kb ? -1 : ka > kb ? 1 : 0),
    );
  return {
    daily: [...daily].map(([serviceDate, v]) => ({ serviceDate, ...v })),
    byEffect: ranked(byEffect).map(([effect, v]) => ({
      effect,
      category: alertCategoryOf(effect),
      ...v,
    })),
    byCause: ranked(byCause).map(([cause, v]) => ({ cause, ...v })),
    totals,
  };
}
