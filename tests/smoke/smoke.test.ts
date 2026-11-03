// デプロイ後のスモークテスト（004 T023、TR-002）。dev / prod の web に対して、IAP を通して実行する。
// pnpm test には含めない（pnpm test:smoke）。パイプラインが次の環境変数を渡す:
//   SMOKE_BASE_URL  … 対象の URL（prod の切り替え前は candidate タグの URL）
//   SMOKE_ID_TOKEN  … smoke-tester の ID トークン（IAP を通るためのもの。ログに出さない）
// 主要な内部 API の確認は 002 の完了後に足す（T048）。
import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "@/lib/api-schemas/health";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`環境変数 ${name} を設定してください`);
  return value;
}

const baseUrl = requiredEnv("SMOKE_BASE_URL").replace(/\/+$/, "");
const idToken = requiredEnv("SMOKE_ID_TOKEN");

function get(path: string, init: RequestInit = {}): Promise<Response> {
  // IAP のログイン画面へのリダイレクトを、そのまま拒否として見るため、リダイレクトをたどらない
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
}

describe("スモークテスト", () => {
  it("/api/health が 200 で、DB に接続できている", async () => {
    const res = await get("/api/health", { headers: { authorization: `Bearer ${idToken}` } });
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body.status).toBe("ok");
  });

  it("認証なしのリクエストは IAP で拒否される", async () => {
    const res = await get("/api/health");
    // 401 / 403、またはログイン画面へのリダイレクト
    expect([301, 302, 303, 307, 401, 403]).toContain(res.status);
  });
});
