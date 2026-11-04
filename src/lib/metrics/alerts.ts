// アラートの一覧（002 US3）で使う計算。純粋関数（現在時刻は引数で受け取る）。
// 定義は specs/002-live-dashboard/contracts/live-api.md の GET /api/live/alerts。
import { alertStatus, type ActivePeriod, type AlertStatus } from "./live";

export interface AlertTiming {
  periods: readonly ActivePeriod[];
  /** 今の MBTA のフィードにあるか */
  inFeed: boolean;
  /** 最後にフィードで見た時刻 */
  lastSeenAt: Date;
}

/**
 * 実際に有効だった区間: フィードから消えたアラートは、終わりのない区間（end が null）や、
 * 最後に見た時刻より後まで続く区間を、最後に見た時刻で終わらせる（MBTA は解消したアラートをフィードから消す）
 */
export function effectivePeriods(alert: AlertTiming): ActivePeriod[] {
  if (alert.inFeed) return [...alert.periods];
  const seen = alert.lastSeenAt.getTime();
  return alert.periods.flatMap((p) => {
    if (p.start.getTime() >= seen) return [];
    const end = p.end === null || p.end.getTime() > seen ? alert.lastSeenAt : p.end;
    return [{ start: p.start, end }];
  });
}

/** アラートの状態: フィードから消えたものは past、それ以外は active_period と現在時刻から計算する */
export function alertStatusOf(alert: AlertTiming, now: Date): AlertStatus {
  return alert.inFeed ? alertStatus(alert.periods, now) : "past";
}

/** 実際に有効だった区間のどれかが [from, to) と重なるか */
export function alertOverlaps(alert: AlertTiming, from: Date, to: Date): boolean {
  return effectivePeriods(alert).some(
    (p) => p.start.getTime() < to.getTime() && (p.end === null || p.end.getTime() > from.getTime()),
  );
}
