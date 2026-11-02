// 結合テストと再生テストの前に一度だけ実行する: テスト用 DB を空にして、マイグレーションを適用する
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { testDatabaseUrl } from "./test-env";

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS "partitions" CASCADE');
    await client.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await client.query('CREATE SCHEMA "public"');
  } finally {
    await client.end();
  }
  const prisma = path.join(import.meta.dirname, "../../node_modules/.bin/prisma");
  execFileSync(prisma, ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
