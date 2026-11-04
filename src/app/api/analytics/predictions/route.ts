// GET /api/analytics/predictions（specs/003-analytics/contracts/analytics-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getAnalyticsPredictions } from "@/lib/api/analytics-predictions";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getAnalyticsPredictions({ db: getDb(), clock: systemClock })(request);
}
