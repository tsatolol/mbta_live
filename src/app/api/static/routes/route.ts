// GET /api/static/routes（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getRoutes } from "@/lib/api/static-routes";

export const dynamic = "force-dynamic";

export function GET() {
  return getRoutes({ db: getDb(), clock: systemClock })();
}
