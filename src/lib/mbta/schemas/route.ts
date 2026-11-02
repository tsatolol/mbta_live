// /routes の行の zod スキーマとドメイン型への変換（contracts/mbta-api.md の「/routes」）
import { z } from "zod";
import { isTargetRouteId } from "../constants";
import { parseDocument, type ParsedDocument } from "../jsonapi";

export const routeRowSchema = z
  .object({
    id: z.string(),
    type: z.literal("route"),
    attributes: z.object({
      short_name: z.string(),
      long_name: z.string(),
      type: z.number().int(),
      color: z.string(),
      text_color: z.string(),
      direction_names: z.array(z.string().nullable()),
      direction_destinations: z.array(z.string().nullable()),
      sort_order: z.number().int(),
    }),
  })
  .transform(({ id, attributes: a }) => ({
    id,
    shortName: a.short_name,
    longName: a.long_name,
    type: a.type,
    color: a.color,
    textColor: a.text_color,
    directionNames: a.direction_names,
    directionDestinations: a.direction_destinations,
    sortOrder: a.sort_order,
  }));

export type Route = z.output<typeof routeRowSchema>;

/** 路線を解析し、対象 8 路線だけを返す */
export function parseRoutes(body: unknown): ParsedDocument<Route> {
  const parsed = parseDocument(body, routeRowSchema);
  return { ...parsed, rows: parsed.rows.filter((r) => isTargetRouteId(r.id)) };
}
