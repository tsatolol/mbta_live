"use client";
// 地図（005 US2）: MapLibre GL JS + OpenFreeMap の明暗スタイル。路線形状を路線色の線で、車両を進行方向に回転した矢印で描く。
// 更新の止まった車両は灰色。車両をクリックするとポップアップを出す。
// E2E は canvas の見た目ではなく、window.__mbtaMap（地図のインスタンス）のソースとレイヤーの状態で確かめる（research.md）
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type FilterSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import { useEffect, useRef } from "react";
import type { RoutesResponse } from "@/lib/api-schemas/routes";
import type { Vehicle } from "@/lib/api-schemas/vehicles";
import { useResolvedTheme } from "@/components/theme/use-theme";
import { lineColorToken } from "@/lib/display/line-counts";
import { ageLabel, statusLabel } from "./vehicle-format";

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const BOSTON_CENTER: [number, number] = [-71.08, 42.35];
const DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
const ARROW_IMAGE = "vehicle-arrow";
/** MapLibre の Web Worker（scripts/copy-maplibre-worker.mjs がビルドの前に public/vendor/ に置く） */
const WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

declare global {
  interface Window {
    __mbtaMap?: MapLibreMap;
  }
}

/** 上向きの矢印（SDF。icon-color で色を変えられる） */
function arrowImage(size = 32): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas が使えません");
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size - 5, size - 4);
  ctx.lineTo(size / 2, size - 11);
  ctx.lineTo(5, size - 4);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function vehiclesGeoJson(vehicles: Vehicle[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: vehicles.map((v) => ({
      type: "Feature",
      id: v.id,
      geometry: { type: "Point", coordinates: [v.lon, v.lat] },
      properties: {
        id: v.id,
        routeId: v.routeId,
        color: v.isStale ? token("--line-stale") : token(lineColorToken(v.routeId)),
        bearing: v.bearing ?? 0,
        hasBearing: v.bearing !== null,
        isStale: v.isStale,
      },
    })),
  };
}

/** ポップアップの中身（DOM で組み立てる。文字列の HTML を使わない） */
function popupContent(v: Vehicle, now: Date): HTMLElement {
  const root = document.createElement("div");
  root.className = "text-sm";
  root.dataset.testid = "vehicle-popup";
  const rows: [string, string][] = [
    ["Route", v.routeId],
    ["To", v.destination ?? ""],
    ["Next stop", v.stopName ?? ""],
    ["Status", statusLabel(v.currentStatus)],
    ["Updated", ageLabel(new Date(v.updatedAt), now)],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    const key = document.createElement("span");
    key.className = "font-medium";
    key.textContent = `${label}: `;
    const text = document.createElement("span");
    text.textContent = value;
    text.dataset.field = label;
    row.append(key, text);
    root.append(row);
  }
  return root;
}

export interface LiveMapProps {
  routes: RoutesResponse;
  vehicles: Vehicle[];
  /** 表示する路線 */
  selectedRouteIds: readonly string[];
}

export default function LiveMap({ routes, vehicles, selectedRouteIds }: LiveMapProps) {
  const theme = useResolvedTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const styleUrlRef = useRef(MAP_STYLE_URL);
  // 地図のイベント（load・click）から最新の値を読むための ref。描画中ではなく effect で更新する
  const vehiclesRef = useRef(vehicles);
  const selectedRouteIdsRef = useRef(selectedRouteIds);
  useEffect(() => {
    vehiclesRef.current = vehicles;
    selectedRouteIdsRef.current = selectedRouteIds;
  }, [vehicles, selectedRouteIds]);

  // 地図を作る（最初の 1 回）
  useEffect(() => {
    if (!containerRef.current) return;
    setWorkerUrl(new URL(WORKER_URL, window.location.origin).href);
    const initialStyle =
      getComputedStyle(document.documentElement).colorScheme === "dark"
        ? DARK_STYLE_URL
        : MAP_STYLE_URL;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: initialStyle,
      center: BOSTON_CENTER,
      zoom: 11,
      attributionControl: { compact: true },
    });
    styleUrlRef.current = initialStyle;
    mapRef.current = map;
    window.__mbtaMap = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    // setStyle はソース・レイヤー・画像を消すので、毎回最新の値で作り直す。
    map.on("style.load", () => {
      map.addImage(ARROW_IMAGE, arrowImage(), { sdf: true });
      map.addSource("routes", {
        type: "geojson",
        data: {
          ...routes.shapes,
          features: routes.shapes.features.map((f) => ({
            ...f,
            properties: { ...f.properties, color: token(lineColorToken(f.properties.routeId)) },
          })),
        },
      });
      map.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 5 },
      });
      map.addSource("vehicles", { type: "geojson", data: vehiclesGeoJson(vehiclesRef.current) });
      map.addLayer({
        id: "vehicles",
        type: "symbol",
        source: "vehicles",
        layout: {
          "icon-image": ARROW_IMAGE,
          "icon-size": 0.91,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-halo-color": token("--panel"),
          "icon-halo-width": 1,
        },
      });

      loadedRef.current = true;
      applyFilter(map, selectedRouteIdsRef.current);
      map.getContainer().dataset.loaded = "true";
    });

    map.on("click", "vehicles", (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id;
      const vehicle = vehiclesRef.current.find((v) => v.id === id);
      if (!vehicle) return;
      new Popup({ closeButton: true })
        .setLngLat([vehicle.lon, vehicle.lat])
        .setDOMContent(popupContent(vehicle, new Date()))
        .addTo(map);
    });
    map.on("mouseenter", "vehicles", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "vehicles", () => (map.getCanvas().style.cursor = ""));

    return () => {
      resize.disconnect();
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
      if (window.__mbtaMap === map) delete window.__mbtaMap;
    };
    // 路線形状は最初に一度だけ渡す（静的データ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const url = theme === "dark" ? DARK_STYLE_URL : MAP_STYLE_URL;
    if (!map || styleUrlRef.current === url) return;
    loadedRef.current = false;
    map.getContainer().dataset.loaded = "false";
    styleUrlRef.current = url;
    map.setStyle(url, { diff: false });
  }, [theme]);

  // 車両を更新する
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("vehicles") as GeoJSONSource | undefined)?.setData(vehiclesGeoJson(vehicles));
  }, [vehicles]);

  // 路線フィルタ
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyFilter(map, selectedRouteIds);
  }, [selectedRouteIds]);

  return <div ref={containerRef} className="h-full w-full" data-testid="live-map" />;
}

function applyFilter(map: MapLibreMap, routeIds: readonly string[]): void {
  const filter: FilterSpecification = ["in", ["get", "routeId"], ["literal", [...routeIds]]];
  map.setFilter("routes", filter);
  map.setFilter("vehicles", filter);
}
