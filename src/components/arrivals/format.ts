// 到着表示の文字列（純粋関数。単体テストする）
import { minutesUntil } from "@/lib/metrics/live";

/** あと何分か: 1 分以上は「n min」、1 分未満は「< 1 min」。過ぎた便は null（表示しない） */
export function countdownLabel(time: Date, now: Date): string | null {
  const ms = time.getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = minutesUntil(time, now);
  return minutes >= 1 ? `${minutes} min` : "< 1 min";
}

/** 毎秒進むカウントダウン（m:ss）。過ぎた便は null */
export function countdownClock(time: Date, now: Date): string | null {
  const totalSec = Math.floor((time.getTime() - now.getTime()) / 1000);
  if (totalSec < 0) return null;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 駅名の検索: 大文字・小文字と前後の空白を無視した部分一致。空の検索語はすべてに一致する */
export function matchesStationQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}
