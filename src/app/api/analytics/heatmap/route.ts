// GET /api/analytics/heatmap（specs/003-analytics/contracts/analytics-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getAnalyticsHeatmap } from "@/lib/api/analytics-heatmap";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getAnalyticsHeatmap({ db: getDb(), clock: systemClock })(request);
}
