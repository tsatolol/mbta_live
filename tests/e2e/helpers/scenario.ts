// E2E の共通の定数（シードの側と、テストの側の両方で使う。server-only のコードを import しない）

export type E2eScenario = "base" | "stale-collection" | "out-of-service" | "analytics";

/** E2E 用の DB。開発用の DB とテスト用の DB とは別にする（中身は作り直される） */
export const DEFAULT_E2E_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/mbta_live_e2e";

export function e2eDatabaseUrl(): string {
  return process.env.E2E_DATABASE_URL || DEFAULT_E2E_DATABASE_URL;
}

/** シードで状態を作る対象 */
export const E2E_FIXTURES = {
  /** 運休・通過の便を作る駅（Park Street） */
  station: "place-pktrm",
  /** 有効なアラート（STATION_ISSUE 2 件）がある駅（Jackson Square） */
  alertStation: "place-jaksn",
  /** フィードから消えた過去のアラート（3 日前の Red の遅延。シードで作る） */
  pastAlert: {
    id: "e2e-past-delay",
    header: "Red Line delays of about 15 minutes due to a disabled train",
  },
} as const;
