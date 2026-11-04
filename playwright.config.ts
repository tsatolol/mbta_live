// E2E（002 TR-003・TR-004）。pnpm test:e2e で実行する（pnpm test には含めない）。
// E2E 用の DB（E2E_DATABASE_URL）に向けて、本番と同じビルドを起動する。DEV バッジを確かめるため APP_ENV=dev で起動する
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./tests/e2e/helpers/scenario";

const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["dev/**"],
  globalSetup: "./tests/e2e/global-setup.ts",
  // シナリオを切り替えるテストがあるので、DB を共有するテストを並行に動かさない
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: "America/New_York",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    // E2E 用の DB は globalSetup が作るが、Playwright は webServer を globalSetup より先に起動して待つ。
    // DB がなくても 200 を返すページ（画面はブラウザでデータを取る）で起動を確かめる
    url: `http://localhost:${PORT}/stations`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      APP_ENV: "dev",
    },
  },
});
