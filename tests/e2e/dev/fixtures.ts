// dev での E2E の共通部分: IAP を通るため、dev のオリジンへのリクエストにだけ ID トークンを付ける
// （地図タイルなど外部へのリクエストには付けない）。同じコンテキストで開いたページすべてに効く
import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  context: async ({ context, baseURL }, provide) => {
    const token = process.env.DEV_ID_TOKEN;
    if (!token) throw new Error("環境変数 DEV_ID_TOKEN を設定してください");
    if (!baseURL) throw new Error("baseURL がありません");
    const origin = new URL(baseURL).origin;
    await context.route(
      (url) => url.origin === origin,
      (route) =>
        route.continue({
          headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
        }),
    );
    await provide(context);
  },
});

export { expect };
