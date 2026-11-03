import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      // server-only はサーバー以外から import されると例外を投げる。テストはサーバー側のコードなので空のモジュールにする
      "server-only": path.join(root, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    // 再生テスト（tests/replay/）は連続ポーリングを記録した後に追加する（T058）
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"],
          // すべてのテストが同じテスト用 DB を使うので、ファイルを並行に実行しない
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "replay",
          include: ["tests/replay/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        // デプロイ後のスモークテスト。pnpm test には含めない（pnpm test:smoke）
        extends: true,
        test: { name: "smoke", include: ["tests/smoke/**/*.test.ts"], testTimeout: 30_000 },
      },
    ],
  },
});
