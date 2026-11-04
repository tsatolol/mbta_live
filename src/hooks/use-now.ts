"use client";
// 一定間隔で現在時刻を更新する（stale の判定やカウントダウンを、データの取得と関係なく進めるため）
import { useEffect, useState } from "react";

export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
