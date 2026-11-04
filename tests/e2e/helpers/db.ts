// E2E から E2E 用の DB を読む（シードで作った行を確かめるため。書き込みはシードだけ）
import pg from "pg";
import { e2eDatabaseUrl } from "./scenario";

/** schedule_relationship がその値の、指定の親駅のホームの便の trip_id */
export async function tripIdsAt(station: string, scheduleRelationship: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: e2eDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query<{ trip_id: string }>(
      `SELECT p."trip_id" FROM "predictions_current" p
         JOIN "stops" s ON s."id" = p."stop_id"
        WHERE s."parent_station_id" = $1 AND p."schedule_relationship" = $2
        ORDER BY p."trip_id"`,
      [station, scheduleRelationship],
    );
    return result.rows.map((r) => r.trip_id);
  } finally {
    await client.end();
  }
}
