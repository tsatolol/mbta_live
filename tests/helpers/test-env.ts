// テスト用 DB の接続先。TEST_DATABASE_URL があればそれを、なければ docker compose の DB を使う
export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/mbta_live_test";

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}
