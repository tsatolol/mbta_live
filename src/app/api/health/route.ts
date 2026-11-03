// GET /api/health: Cloud Run の起動確認、スモークテスト、監視で使う。DB に接続できなければ 503。
import { NextResponse } from "next/server";
import { systemClock } from "@/lib/clock";
import { getDb } from "@/lib/db/client";
import { checkHealth } from "@/lib/db/health";
import { errorFields, logger } from "@/lib/log";

// 毎回 DB を見るので、ビルド時に静的化しない
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const result = await checkHealth(getDb(), systemClock);
  if (!result.ok) {
    logger.error("ヘルスチェックで DB に接続できませんでした", errorFields(result.error));
    return NextResponse.json(result.body, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  return NextResponse.json(result.body, { headers: { "cache-control": "no-store" } });
}
