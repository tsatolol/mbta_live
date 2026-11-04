// 内部 API の応答で共通に使う部品（specs/002-live-dashboard/contracts/live-api.md）。
// Route Handler（応答を組み立てる側）と画面（受け取る側）の両方で使う。時刻は ISO 8601 の UTC 文字列。
import { z } from "zod";

export const isoDateTime = z.iso.datetime();

/** 不正なリクエストへの応答（400 / 404 / 500） */
export const errorResponseSchema = z.object({ error: z.string() });
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** すべての応答に含める項目: 最後に収集に成功した時刻（画面の Last updated と stale の判定）と、応答を作った時刻 */
export const liveMetaSchema = z.object({
  lastCollectedAt: isoDateTime.nullable(),
  generatedAt: isoDateTime,
});
export type LiveMeta = z.infer<typeof liveMetaSchema>;

/** 対象の 8 路線の ID（クエリパラメータの検証に使う） */
export const routeIdSchema = z.string().min(1).max(32);

/** カンマ区切りの路線 ID（`routes=Red,Orange`）。空なら undefined（全路線） */
export const routeListParamSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.trim() === ""
      ? undefined
      : value
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
  )
  .pipe(z.array(routeIdSchema).max(16).optional());
