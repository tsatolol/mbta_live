// アラートの表示に使う関数（純粋関数。単体テストする）
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { formatInBoston } from "@/lib/time";

/** effect（DELAY、STATION_ISSUE など）を読みやすくする */
export function effectLabel(effect: string): string {
  return effect
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** 有効な区間の表示（ボストン時間）。終わりのない区間は「until further notice」 */
export function periodLabel(period: { start: string; end: string | null }): string {
  const start = formatInBoston(new Date(period.start), "MMM d, h:mm a");
  if (period.end === null) return `${start} – until further notice`;
  return `${start} – ${formatInBoston(new Date(period.end), "MMM d, h:mm a")}`;
}

export interface AlertGroup {
  /** 関係する路線（路線の並び順） */
  routeIds: string[];
  alerts: AlertItem[];
}

/**
 * 路線ごとにまとめる: 関係する路線の組み合わせが同じアラートを 1 つのまとまりにする
 * （Green の 4 支線にまたがるアラートを支線ごとに 4 回出さないため）。
 * まとまりは最初の路線の並び順、同じなら路線の少ない順。中のアラートは受け取った順（重要度の高い順）のまま
 */
export function groupAlertsByRoutes(
  alerts: readonly AlertItem[],
  routeOrder: readonly string[],
): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const alert of alerts) {
    const key = alert.routeIds.join(",");
    const group = groups.get(key) ?? { routeIds: alert.routeIds, alerts: [] };
    group.alerts.push(alert);
    groups.set(key, group);
  }
  const rank = (id: string | undefined) => {
    const i = id === undefined ? -1 : routeOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...groups.values()].sort(
    (a, b) => rank(a.routeIds[0]) - rank(b.routeIds[0]) || a.routeIds.length - b.routeIds.length,
  );
}

/** 検索で選べる影響の種類（MBTA の effect のうち、地下鉄でよく使われるもの） */
export const SEARCHABLE_EFFECTS = [
  "DELAY",
  "SUSPENSION",
  "SHUTTLE",
  "STATION_CLOSURE",
  "STATION_ISSUE",
  "STOP_CLOSURE",
  "SERVICE_CHANGE",
  "TRACK_CHANGE",
  "DETOUR",
  "CANCELLATION",
  "ELEVATOR_CLOSURE",
  "ESCALATOR_CLOSURE",
  "ACCESS_ISSUE",
  "NOTICE",
  "OTHER_EFFECT",
] as const;
