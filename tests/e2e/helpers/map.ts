// 地図の E2E の補助: 地図のタイル（OpenFreeMap）を外部から取らず、空のスタイルを返す。
// 地図の中身（路線・車両）の確認にタイルは要らず、外部のサーバーに頼らずに済む。タイルの読み込みは dev での E2E（004 T049）で確かめる
import type { Page } from "@playwright/test";

const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f5f5f5" } }],
};

export async function stubMapTiles(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", (route) => {
    if (route.request().url().includes("/styles/")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(BLANK_STYLE) });
    }
    return route.abort();
  });
}

/** 地図が読み込まれ（ソースとレイヤーを足し終え）、描画が落ち着くまで待つ */
export async function waitForMap(page: Page): Promise<void> {
  await page.locator('[data-testid="live-map"][data-loaded="true"]').waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = window.__mbtaMap;
        if (!map) throw new Error("地図がありません");
        if (map.loaded() && !map.isMoving()) resolve();
        else map.once("idle", () => resolve());
      }),
  );
}

export interface VehicleFeature {
  id: string;
  routeId: string;
  color: string;
  isStale: boolean;
  lon: number;
  lat: number;
}

/** 地図の vehicles ソースの中身 */
export function vehicleFeatures(page: Page): Promise<VehicleFeature[]> {
  return page.evaluate(() => {
    const source = window.__mbtaMap?.getSource("vehicles");
    const data = source?.serialize().data as {
      features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[];
    };
    return data.features.map((f) => ({
      id: String(f.properties.id),
      routeId: String(f.properties.routeId),
      color: String(f.properties.color),
      isStale: Boolean(f.properties.isStale),
      lon: f.geometry.coordinates[0] ?? 0,
      lat: f.geometry.coordinates[1] ?? 0,
    }));
  });
}
