// GET /api/analytics/headways（specs/003-analytics/contracts/analytics-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getAnalyticsHeadways } from "@/lib/api/analytics-headways";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getAnalyticsHeadways({ db: getDb(), clock: systemClock })(request);
}
