// T023: パーティションの子テーブルを partitions スキーマに置いても、Prisma が drift とみなさないことを確かめる
// （specs/001-data-collection/research.md の未解決事項）
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePartitions, listPartitions } from "@/lib/db/partitions";
import { createTestDb, resetData, testDatabaseUrl } from "../helpers/db";

const run = promisify(execFile);
const root = path.join(import.meta.dirname, "../..");
const prisma = path.join(root, "node_modules/.bin/prisma");
const db = createTestDb();

beforeAll(async () => {
  await resetData(db);
  await ensurePartitions(db, ["2026-11-01", "2026-11-02", "2026-11-03"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Prisma の drift", () => {
  it("子テーブルを作った後も、DB とスキーマの差分がない", async () => {
    expect(await listPartitions(db)).toHaveLength(9);
    const result = await run(
      prisma,
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "prisma/schema.prisma",
        "--exit-code",
      ],
      { cwd: root, env: { ...process.env, DATABASE_URL: testDatabaseUrl() } },
    ).then(
      (r) => ({ code: 0, stdout: r.stdout }),
      (e: { code?: number; stdout?: string }) => ({ code: e.code ?? -1, stdout: e.stdout ?? "" }),
    );
    // --exit-code: 0 = 差分なし、2 = 差分あり
    expect(result.stdout).toContain("No difference detected");
    expect(result.code).toBe(0);
  });

  it("マイグレーションの履歴と DB の間にも差分がない（migrate status）", async () => {
    const { stdout } = await run(prisma, ["migrate", "status"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    });
    expect(stdout).toContain("Database schema is up to date");
  });
});
