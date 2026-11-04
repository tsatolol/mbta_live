// dev での E2E（004 T049 / 002 T035、TR-007）。デプロイした dev の web に、IAP を通して読み取りだけの短いテストを実行する。
// scripts/dev-e2e.sh から実行する（smoke-tester の ID トークンを発行して渡す）:
//   DEV_BASE_URL … dev の web の URL
//   DEV_ID_TOKEN … smoke-tester の ID トークン（dev のオリジンへのリクエストにだけ付ける。ログ・トレースに残さない）
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.DEV_BASE_URL;
if (!baseURL) throw new Error("環境変数 DEV_BASE_URL を設定してください");

export default defineConfig({
  testDir: "tests/e2e/dev",
  workers: 1,
  forbidOnly: !!process.env.CI,
  // コールドスタートや外部のタイルの一時的な失敗に備えて 1 回だけやり直す
  retries: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: baseURL.replace(/\/+$/, ""),
    timezoneId: "America/New_York",
    locale: "en-US",
    // トレースには Authorization ヘッダーが残るので取らない
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
