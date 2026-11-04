// GET /api/analytics/alerts（specs/003-analytics/contracts/analytics-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getAnalyticsAlerts } from "@/lib/api/analytics-alerts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getAnalyticsAlerts({ db: getDb(), clock: systemClock })(request);
}
