// リアルタイム画面（002）で計算して返す値。純粋関数（現在時刻は引数で受け取る）。
// 定義は specs/002-live-dashboard/contracts/live-api.md の「計算して返す値」。
import { STALE_LIVE_DATA_SEC, STALE_VEHICLE_SEC } from "./constants";

/** 車両の位置が古いか: now - updated_at >= 3 分 */
export function isStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() >= STALE_VEHICLE_SEC * 1000;
}

export type AlertStatus = "active" | "upcoming" | "past";

export interface ActivePeriod {
  start: Date;
  /** 終わりのない区間は null */
  end: Date | null;
}

/**
 * アラートの状態: active_period のいずれかの区間に現在時刻が入っていれば active、
 * すべての区間が未来なら upcoming、それ以外（すべて過去、区間がない）は past。
 * 区間は [start, end)（end は含まない）
 */
export function alertStatus(periods: readonly ActivePeriod[], now: Date): AlertStatus {
  const t = now.getTime();
  const inPeriod = periods.some(
    (p) => p.start.getTime() <= t && (p.end === null || t < p.end.getTime()),
  );
  if (inPeriod) return "active";
  if (periods.length > 0 && periods.every((p) => p.start.getTime() > t)) return "upcoming";
  return "past";
}

/** あと何分か（切り捨て）。過ぎた時刻は負の値になる（表示する側で除く） */
export function minutesUntil(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / 60_000);
}

/** 画面の stale バナーを出すか: 最後に収集に成功してから 3 分以上経った。まだ一度も成功していなければ true */
export function isLiveDataStale(lastCollectedAt: Date | null, now: Date): boolean {
  if (lastCollectedAt === null) return true;
  return now.getTime() - lastCollectedAt.getTime() >= STALE_LIVE_DATA_SEC * 1000;
}
