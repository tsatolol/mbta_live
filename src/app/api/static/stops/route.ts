// GET /api/static/stops（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getStops } from "@/lib/api/static-stops";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getStops({ db: getDb(), clock: systemClock })(request);
}
