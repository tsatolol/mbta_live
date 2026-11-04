// Google の encoded polyline（MBTA の shape の polyline）をデコードする。
// 形式: https://developers.google.com/maps/documentation/utilities/polylinealgorithm（精度 1e-5）

/** GeoJSON の座標（[経度, 緯度]） */
export type LonLat = [number, number];

/** encoded polyline を GeoJSON の座標の配列（[lon, lat]）にする。壊れた文字列は例外 */
export function decodePolyline(encoded: string, precision = 5): LonLat[] {
  const factor = 10 ** precision;
  const coordinates: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const readValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error("encoded polyline が途中で終わっています");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("encoded polyline に使えない文字があります");
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readValue();
    lon += readValue();
    coordinates.push([lon / factor, lat / factor]);
  }
  return coordinates;
}
