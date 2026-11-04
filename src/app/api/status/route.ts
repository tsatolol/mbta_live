// GET /api/status（specs/002-live-dashboard/contracts/live-api.md）
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { getStatus } from "@/lib/api/status";

export const dynamic = "force-dynamic";

export function GET() {
  return getStatus({ db: getDb(), clock: systemClock })();
}
