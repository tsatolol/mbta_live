// テストでフィクスチャを読む補助関数
import { readFile } from "node:fs/promises";
import path from "node:path";

export const FIXTURES_DIR = path.join(import.meta.dirname, "../fixtures/mbta");

/** tests/fixtures/mbta/ からの相対パスで JSON を読む */
export async function readFixture(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, relativePath), "utf8"));
}

/** 平日の日中（2026-11-02 10:20 ET）に記録したフィクスチャ */
export const WEEKDAY = {
  vehicles: "vehicles-20261102-1020.json",
  predictions: "predictions-20261102-1020.json",
  alerts: "alerts-20261102-1020.json",
  recordedAt: new Date("2026-11-02T15:20:00Z"),
} as const;

/** 日曜の始発直後（2026-11-01 05:48 ET）に記録したフィクスチャ */
export const SUNDAY = {
  vehicles: "vehicles-20261101-0548.json",
  predictions: "predictions-20261101-0548.json",
  alerts: "alerts-20261101-0422.json",
  recordedAt: new Date("2026-11-01T10:48:00Z"),
} as const;
