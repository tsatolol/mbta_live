// 結合テスト用の DB の補助関数
import { createDb, type Db } from "@/lib/db/client";
import { PARTITION_SCHEMA } from "@/lib/db/partitions";
import { testDatabaseUrl } from "./test-env";

export { testDatabaseUrl };

export function createTestDb(): Db {
  return createDb(testDatabaseUrl());
}

/** public のテーブルをすべて空にし、パーティションの子テーブルを削除する（_prisma_migrations は残す） */
export async function resetData(db: Db): Promise<void> {
  const partitions = await db.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables WHERE schemaname = ${PARTITION_SCHEMA}`;
  for (const { name } of partitions) {
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PARTITION_SCHEMA}"."${name}"`);
  }
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ name }) => `"public"."${name}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
}
