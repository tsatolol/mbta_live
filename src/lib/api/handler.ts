// 内部 API（Route Handler）の共通部分: クエリパラメータの検証（不正なら 400）、応答の形の確認、
// キャッシュしない、例外のログ。すべて GET・読み取り専用（specs/002-live-dashboard/contracts/live-api.md）
import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { Clock } from "@/lib/clock";
import type { Db } from "@/lib/db/client";
import { getLastCollectedAt } from "@/lib/db/live";
import type { ErrorResponse, LiveMeta } from "@/lib/api-schemas/common";
import { errorFields, logger } from "@/lib/log";

const NO_STORE = { "cache-control": "no-store" } as const;

/** エラーの応答（{ error: string }） */
export function errorResponse(
  status: 400 | 404 | 500,
  message: string,
): NextResponse<ErrorResponse> {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export type ParseResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse<ErrorResponse> };

/** クエリパラメータを zod で検証する。同じ名前が複数あるときは最後の値を使う */
export function parseQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): ParseResult<z.output<S>> {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`)
      .join("; ");
    return { ok: false, response: errorResponse(400, `Invalid query parameter: ${message}`) };
  }
  return { ok: true, data: parsed.data };
}

/** 応答の形を共有のスキーマで確かめてから返す（契約と違う応答を返さない） */
export function okResponse<S extends z.ZodType>(schema: S, body: z.input<S>): NextResponse {
  return NextResponse.json(schema.parse(body), { headers: NO_STORE });
}

/** すべての応答に含める lastCollectedAt と generatedAt */
export async function liveMeta(db: Db, clock: Clock): Promise<LiveMeta> {
  const lastCollectedAt = await getLastCollectedAt(db);
  return {
    lastCollectedAt: lastCollectedAt?.toISOString() ?? null,
    generatedAt: clock.now().toISOString(),
  };
}

/** 例外をログに出して 500 にする（秘密の値を含む可能性のある内容は応答に出さない） */
export async function withErrorHandling(
  name: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`内部 API ${name} でエラーが起きました`, errorFields(error));
    return errorResponse(500, "Internal server error");
  }
}
