// GET /api/live/vehicles（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getVehicles } from "@/lib/api/live-vehicles";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return getVehicles({ db: getDb(), clock: systemClock })(request);
}
