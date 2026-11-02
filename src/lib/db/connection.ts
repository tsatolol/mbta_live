// DB の接続先を環境変数から組み立てる。アプリ（src/lib/db/client.ts）と Prisma CLI（prisma.config.ts）の両方で使う。
// Prisma CLI からも読み込むので、ここでは server-only を import しない。
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  INSTANCE_CONNECTION_NAME: z.string().min(1).optional(),
  DB_NAME: z.string().min(1).optional(),
  DB_USER: z.string().min(1).optional(),
  DB_PASSWORD: z.string().optional(),
});

/**
 * 接続文字列を返す。
 * - DATABASE_URL があればそれを使う（ローカル、テスト）
 * - なければ Cloud Run の Unix ソケット /cloudsql/<INSTANCE_CONNECTION_NAME> に接続する
 * - どちらもなければ undefined（prisma generate など DB に接続しない操作用）
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const parsed = envSchema.parse({
    DATABASE_URL: env.DATABASE_URL || undefined,
    INSTANCE_CONNECTION_NAME: env.INSTANCE_CONNECTION_NAME || undefined,
    DB_NAME: env.DB_NAME || undefined,
    DB_USER: env.DB_USER || undefined,
    DB_PASSWORD: env.DB_PASSWORD,
  });
  if (parsed.DATABASE_URL) return parsed.DATABASE_URL;
  if (!parsed.INSTANCE_CONNECTION_NAME) return undefined;
  if (!parsed.DB_NAME || !parsed.DB_USER) {
    throw new Error("INSTANCE_CONNECTION_NAME を使うときは DB_NAME と DB_USER も必要です");
  }
  const user = encodeURIComponent(parsed.DB_USER);
  const password = encodeURIComponent(parsed.DB_PASSWORD ?? "");
  const host = encodeURIComponent(`/cloudsql/${parsed.INSTANCE_CONNECTION_NAME}`);
  return `postgresql://${user}:${password}@localhost/${encodeURIComponent(parsed.DB_NAME)}?host=${host}`;
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = resolveDatabaseUrl(env);
  if (!url) {
    throw new Error("DATABASE_URL か INSTANCE_CONNECTION_NAME を設定してください");
  }
  return url;
}
