// 稼働状況の画面の表示用の関数（純粋関数。単体テストする）

/** 経過時間: 「just now」「n min ago」「n h ago」「n days ago」 */
export function agoLabel(at: Date, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** 実行時間（秒、小数 1 桁）。終わっていなければ null */
export function durationLabel(startedAt: Date, finishedAt: Date | null): string | null {
  if (!finishedAt) return null;
  return `${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)} s`;
}

/** 行数（3 桁区切り）。推定値は「~」を付ける */
export function rowCountLabel(rows: number, estimated: boolean): string {
  return `${estimated ? "~" : ""}${rows.toLocaleString("en-US")}`;
}

/** 件数（counts）の要約: 表示する項目だけを「name n」の形で並べる */
export function countsLabel(
  counts: Record<string, number> | null,
  keys: readonly string[],
): string {
  if (!counts) return "";
  return keys
    .filter((k) => counts[k] !== undefined)
    .map((k) => `${k} ${counts[k]!.toLocaleString("en-US")}`)
    .join(" · ");
}

/** ジョブごとに要約に出す件数の項目 */
export const JOB_COUNT_KEYS: Record<string, readonly string[]> = {
  collect: ["vehicles", "predictions", "alerts", "arrivalsInserted", "rejectedRows"],
  "sync-static": ["routes", "stops", "routePatterns"],
  aggregate: ["partitionsEnsured", "droppedServiceDates"],
};
