// GET /api/live/predictions（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getPredictions } from "@/lib/api/live-predictions";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getPredictions({ db: getDb(), clock: systemClock })(request);
}
