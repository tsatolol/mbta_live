// 分析の画面（003）の共通部分: 4 つの画面のタブと、到着時刻の推定精度の注記（FR-008）
import type { ReactNode } from "react";
import { Suspense } from "react";
import { AnalyticsTabs } from "@/components/analytics/analytics-tabs";
import { PrecisionNote } from "@/components/analytics/analytics-notes";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <Suspense>
        <AnalyticsTabs />
      </Suspense>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        {children}
      </Suspense>
      <PrecisionNote />
    </div>
  );
}
