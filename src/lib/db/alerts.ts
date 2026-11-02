// アラートの保存。削除せずに upsert し、フィードにあるかどうかを in_feed で表す（data-model.md）
import type { Alert } from "@/lib/mbta/schemas/alert";
import type { DbTx } from "./types";

/**
 * 今回のフィードのアラートを 1 本の SQL で upsert する。
 * - first_seen_at は初回の値を保ち、last_seen_at を観測時刻にする
 * - 今回のフィードにないアラートは in_feed = false にする
 * - alert_routes は今回のフィードのアラートについて作り直す
 */
export async function upsertAlerts(
  tx: DbTx,
  alerts: readonly Alert[],
  observedAt: Date,
): Promise<void> {
  const ids = alerts.map((a) => a.id);
  if (alerts.length > 0) {
    const rows = alerts.map((a) => ({
      id: a.id,
      effect: a.effect,
      cause: a.cause,
      severity: a.severity,
      header: a.header,
      short_header: a.shortHeader,
      service_effect: a.serviceEffect,
      timeframe: a.timeframe,
      description: a.description,
      lifecycle: a.lifecycle,
      active_period: a.activePeriod,
      informed_entity: a.informedEntity,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    }));
    await tx.$executeRaw`
      INSERT INTO "alerts" (
        "id", "effect", "cause", "severity", "header", "short_header", "service_effect", "timeframe",
        "description", "lifecycle", "active_period", "informed_entity", "created_at", "updated_at",
        "first_seen_at", "last_seen_at", "in_feed"
      )
      SELECT
        x."id", x."effect", x."cause", x."severity", x."header", x."short_header", x."service_effect", x."timeframe",
        x."description", x."lifecycle", x."active_period", x."informed_entity", x."created_at", x."updated_at",
        ${observedAt}, ${observedAt}, TRUE
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
        "id" text, "effect" text, "cause" text, "severity" integer, "header" text, "short_header" text,
        "service_effect" text, "timeframe" text, "description" text, "lifecycle" text,
        "active_period" jsonb, "informed_entity" jsonb, "created_at" timestamptz, "updated_at" timestamptz
      )
      ON CONFLICT ("id") DO UPDATE SET
        "effect" = EXCLUDED."effect",
        "cause" = EXCLUDED."cause",
        "severity" = EXCLUDED."severity",
        "header" = EXCLUDED."header",
        "short_header" = EXCLUDED."short_header",
        "service_effect" = EXCLUDED."service_effect",
        "timeframe" = EXCLUDED."timeframe",
        "description" = EXCLUDED."description",
        "lifecycle" = EXCLUDED."lifecycle",
        "active_period" = EXCLUDED."active_period",
        "informed_entity" = EXCLUDED."informed_entity",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at",
        "last_seen_at" = EXCLUDED."last_seen_at",
        "in_feed" = TRUE`;
  }

  await tx.alert.updateMany({
    where: { inFeed: true, id: { notIn: ids } },
    data: { inFeed: false },
  });

  if (ids.length > 0) {
    await tx.alertRoute.deleteMany({ where: { alertId: { in: ids } } });
    const pairs = alerts.flatMap((a) => a.routeIds.map((routeId) => ({ alertId: a.id, routeId })));
    if (pairs.length > 0) await tx.alertRoute.createMany({ data: pairs, skipDuplicates: true });
  }
}
