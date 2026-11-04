// GET /api/live/alerts（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getAlerts } from "@/lib/api/live-alerts";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getAlerts({ db: getDb(), clock: systemClock })(request);
}
