// テスト用の DB を作り直す（E2E のシードと性能の測定で使う）: DB がなければ作り、スキーマを消してマイグレーションを適用する
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const root = path.join(import.meta.dirname, "../..");

/** DB を（なければ）作り、スキーマを作り直してマイグレーションを適用する */
export async function recreateDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const adminClient = new pg.Client({ connectionString: admin.toString() });
  await adminClient.connect();
  try {
    const exists = await adminClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (exists.rowCount === 0) await adminClient.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await adminClient.end();
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS "partitions" CASCADE');
    await client.query('DROP SCHEMA IF EXISTS "public" CASCADE');
    await client.query('CREATE SCHEMA "public"');
  } finally {
    await client.end();
  }
  execFileSync(path.join(root, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
