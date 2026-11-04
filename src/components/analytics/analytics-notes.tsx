// 分析の画面に出す注記: 到着時刻の推定精度（FR-008）と、集計の状況（今日の分、定義の版の境目）
import type { AnalyticsMeta } from "@/lib/api-schemas/analytics";

export function PrecisionNote() {
  return (
    <p className="text-xs text-muted-foreground" data-testid="precision-note">
      Arrival times are estimated from vehicle positions polled about once a minute, so they are
      accurate to roughly ±60 seconds (less precise on the dev environment).
    </p>
  );
}

export function AggregationNote({ meta }: { meta: AnalyticsMeta }) {
  const versions = [...new Set(meta.definitionVersions.map((v) => v.version))];
  return (
    <p className="text-xs text-muted-foreground" data-testid="aggregation-note">
      Showing service dates {meta.from} to {meta.to}.{" "}
      {meta.todayIncluded && "Today is computed from raw data and may change. "}
      {meta.lastAggregatedServiceDate
        ? `Daily statistics are available through ${meta.lastAggregatedServiceDate}.`
        : "No daily statistics have been aggregated yet."}
      {versions.length > 1 &&
        ` The metric definitions changed within this range (versions ${versions.join(", ")}).`}
    </p>
  );
}
