// スキーマで共通に使う部品
import { z } from "zod";
import { parseMbtaDateTime } from "@/lib/time";

/** MBTA のオフセット付き日時文字列を Date にする */
export const mbtaDateTime = z.string().transform((value, ctx) => {
  try {
    return parseMbtaDateTime(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `日時の形式が正しくありません: ${value}` });
    return z.NEVER;
  }
});

/** リレーションの ID（data が null なら null） */
export const relationId = z
  .object({ data: z.object({ id: z.string() }).nullable() })
  .optional()
  .transform((rel) => rel?.data?.id ?? null);

/** 必ずあるリレーションの ID */
export const requiredRelationId = z
  .object({ data: z.object({ id: z.string() }) })
  .transform((rel) => rel.data.id);
