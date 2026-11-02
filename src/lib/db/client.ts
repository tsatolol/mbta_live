// Prisma Client。接続は driver adapter（@prisma/adapter-pg + pg）経由。
import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { requireDatabaseUrl } from "./connection";

export type Db = PrismaClient;

export function createDb(connectionString: string = requireDatabaseUrl()): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

let shared: Db | undefined;

/** プロセス内で共有する Prisma Client */
export function getDb(): Db {
  shared ??= createDb();
  return shared;
}
