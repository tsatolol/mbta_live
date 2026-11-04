// E2E からシードを実行する。シードは server-only のコードを使うので、別のプロセス（tsx --conditions=react-server）で動かす
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { E2eScenario } from "./scenario";

const root = path.join(import.meta.dirname, "../../..");

export function seedE2e(scenario: E2eScenario, options: { migrate?: boolean } = {}): void {
  execFileSync(
    path.join(root, "node_modules/.bin/tsx"),
    [
      "--conditions=react-server",
      path.join(root, "tests/e2e/seed-db.ts"),
      ...(options.migrate ? ["--migrate"] : []),
      scenario,
    ],
    { cwd: root, env: process.env, stdio: ["ignore", "ignore", "inherit"] },
  );
}
