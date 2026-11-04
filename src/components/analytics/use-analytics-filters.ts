"use client";
// 分析の画面の絞り込み（期間・路線・方向・駅など）を URL のクエリに持つ（リンクで共有でき、戻るで戻せる）
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export type FilterKey = "from" | "to" | "route" | "direction" | "stop" | "updateType" | "metric";
export type Filters = Partial<Record<FilterKey, string>>;

const KEYS: readonly FilterKey[] = [
  "from",
  "to",
  "route",
  "direction",
  "stop",
  "updateType",
  "metric",
];

export function useAnalyticsFilters(): {
  filters: Filters;
  setFilters: (patch: Filters) => void;
  /** API に渡すクエリ文字列（空の値は入れない） */
  query: (keys: readonly FilterKey[]) => string;
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(() => {
    const out: Filters = {};
    for (const key of KEYS) {
      const value = params.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [params]);

  const setFilters = useCallback(
    (patch: Filters) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const query = useCallback(
    (keys: readonly FilterKey[]) => {
      const q = new URLSearchParams();
      for (const key of keys) {
        const value = filters[key];
        if (value) q.set(key, value);
      }
      return q.toString();
    },
    [filters],
  );

  return { filters, setFilters, query };
}
