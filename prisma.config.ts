import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";
import { resolveDatabaseUrl } from "./src/lib/db/connection";

// Prisma 7 は .env を自動で読まないので、ローカルの .env.local があれば読む
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = resolveDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // prisma generate は接続先がなくても動く。migrate などの DB 操作には接続先が必要
  ...(url ? { datasource: { url } } : {}),
});
