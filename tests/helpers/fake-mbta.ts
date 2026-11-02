// テスト用の MBTA API。エンドポイントごとに返す本文を決められる fetch を作る（実 API は呼ばない）
import { vi } from "vitest";
import type { FetchLike } from "@/lib/mbta/client";

export type Endpoint = "vehicles" | "predictions" | "alerts";

export interface FakeMbtaOptions {
  bodies: Record<Endpoint, unknown>;
  /** このエンドポイントだけ 429 を返す */
  rateLimitOn?: Endpoint;
  /** 応答を返す前に待つ（同時実行のテスト用） */
  waitFor?: Promise<void>;
  remaining?: number;
}

export function fakeMbtaFetch(options: FakeMbtaOptions) {
  return vi.fn<FetchLike>(async (input) => {
    if (options.waitFor) await options.waitFor;
    const endpoint = input.pathname.replace(/^\//, "") as Endpoint;
    const headers = {
      "content-type": "application/vnd.api+json",
      "x-ratelimit-limit": "20",
      "x-ratelimit-remaining": String(options.remaining ?? 17),
      "x-ratelimit-reset": "1793524920",
    };
    if (options.rateLimitOn === endpoint) {
      return new Response(JSON.stringify({ errors: [{ status: "429" }] }), {
        status: 429,
        headers: { ...headers, "x-ratelimit-remaining": "0" },
      });
    }
    if (!(endpoint in options.bodies)) return new Response("not found", { status: 404, headers });
    return new Response(JSON.stringify(options.bodies[endpoint]), { status: 200, headers });
  });
}
