// 今日の分の計算（生データからの集計 SQL）の結果を、Web のプロセスのメモリに短い時間だけ残す。
// 収集は prod で 1 分ごとなので、同じ運行日の結果は 1 分ほどは変わらない。絞り込みやタブを変えるたびに
// 同じ計算をしないため（003 T044。28 日の範囲で、今日の分の計算が応答時間の大半を占めた）。
// DB には何も書かない（Web は読み取り専用。憲章）
import "server-only";

/** 残しておく時間 */
export const TODAY_CACHE_TTL_MS = 60_000;

interface Entry {
  expiresAt: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();

/**
 * key（指標と運行日）ごとに、計算の結果を ttl の間だけ使い回す。計算に失敗したら残さない。
 * 同時に来たリクエストは、同じ計算を待つ
 */
export function cachedToday<T>(
  key: string,
  nowMs: number,
  compute: () => Promise<T>,
  ttlMs = TODAY_CACHE_TTL_MS,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > nowMs) return hit.value as Promise<T>;
  const value = compute();
  entries.set(key, { expiresAt: nowMs + ttlMs, value });
  value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  // 古いものを消す（運行日が変わると key が変わるので、増え続けないように）
  for (const [k, e] of entries) if (e.expiresAt <= nowMs) entries.delete(k);
  return value;
}

/** テスト用: すべて消す */
export function clearTodayCache(): void {
  entries.clear();
}
