// データの鮮度の表示（005 US1、FR-003・FR-004）。純粋関数（現在時刻は引数で受け取る）。
// 古いかどうかの境目は 002 の isLiveDataStale（3 分）と同じ
import { isLiveDataStale } from "@/lib/metrics/live";
import { formatInBoston } from "@/lib/time";

export type FreshnessState = "live" | "stale" | "none";

/** 最後に収集に成功してからの経過時間の表示（「12 s ago」）。短い形はスマホのヘッダー用（「12 s」） */
export function freshnessLabel(
  lastCollectedAt: Date | null,
  now: Date,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact ?? false;
  if (lastCollectedAt === null) return compact ? "no data" : "no data yet";
  const sec = Math.max(0, (now.getTime() - lastCollectedAt.getTime()) / 1000);
  const suffix = compact ? "" : " ago";
  if (sec < 5) return compact ? "now" : "just now";
  if (sec < 60) return `${Math.floor(sec)} s${suffix}`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min${suffix}`;
  return `${Math.floor(sec / 3600)} h${suffix}`;
}

/** 鮮度の状態: live（3 分未満）/ stale（3 分以上）/ none（まだ一度も収集していない） */
export function freshnessState(lastCollectedAt: Date | null, now: Date): FreshnessState {
  if (lastCollectedAt === null) return "none";
  return isLiveDataStale(lastCollectedAt, now) ? "stale" : "live";
}

/** データが古いときの帯の文言 */
export function staleMessage(lastCollectedAt: Date | null, now: Date): string {
  if (lastCollectedAt === null) return "Live data is stale: no collection has succeeded yet.";
  return `Live data is stale: the last successful collection was ${freshnessLabel(
    lastCollectedAt,
    now,
  )}, at ${formatInBoston(lastCollectedAt, "h:mm a")} ET.`;
}
