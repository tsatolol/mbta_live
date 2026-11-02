// /alerts の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/alerts」）
import { z } from "zod";
import { isTargetRouteId } from "../constants";
import { parseDocument, type ParsedDocument } from "../jsonapi";
import { mbtaDateTime } from "./common";

const activePeriodSchema = z.object({
  start: mbtaDateTime,
  end: mbtaDateTime.nullable(),
});

const informedEntitySchema = z.looseObject({
  route: z.string().optional(),
  route_type: z.number().optional(),
  stop: z.string().optional(),
  direction_id: z.number().nullable().optional(),
  activities: z.array(z.string()).optional(),
});

export const alertRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("alert"),
    attributes: z.object({
      // effect / cause / lifecycle は列挙型にせず文字列のまま（未知の値もそのまま保存する）
      effect: z.string(),
      cause: z.string(),
      severity: z.number().int(),
      header: z.string(),
      short_header: z.string().nullable().optional(),
      service_effect: z.string().nullable().optional(),
      timeframe: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      lifecycle: z.string(),
      active_period: z.array(activePeriodSchema),
      informed_entity: z.array(informedEntitySchema),
      created_at: mbtaDateTime.nullable().optional(),
      updated_at: mbtaDateTime.nullable().optional(),
    }),
  })
  .transform(({ id, attributes: a }) => ({
    id,
    effect: a.effect,
    cause: a.cause,
    severity: a.severity,
    header: a.header,
    shortHeader: a.short_header ?? null,
    serviceEffect: a.service_effect ?? null,
    timeframe: a.timeframe ?? null,
    description: a.description ?? null,
    lifecycle: a.lifecycle,
    activePeriod: a.active_period,
    informedEntity: a.informed_entity,
    createdAt: a.created_at ?? null,
    updatedAt: a.updated_at ?? null,
    /** informed_entity の route のうち、対象 8 路線のもの（重複なし） */
    routeIds: [
      ...new Set(
        a.informed_entity.flatMap((e) => (e.route && isTargetRouteId(e.route) ? [e.route] : [])),
      ),
    ],
  }));

export type Alert = z.output<typeof alertRowSchema>;

export function parseAlerts(body: unknown): ParsedDocument<Alert> {
  return parseDocument(body, alertRowSchema);
}
