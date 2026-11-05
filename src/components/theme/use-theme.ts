"use client";
// 表示の明るさのフック（005 FR-014）。
// - useThemePreference: 選択（明るい / 暗い / OS に合わせる）を読み書きする。保存できなくてもエラーにしない
// - useResolvedTheme: 実際に使っている表示（明るい / 暗い）。html の data-theme と OS の設定の変化を見る。
//   地図とグラフのように、JavaScript で色を決める部品が使う
import { useCallback, useSyncExternalStore } from "react";
import {
  dataThemeFor,
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

const CHANGE_EVENT = "mbta-live:theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function subscribePreference(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // ほかのタブでの変更
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 選択を当てる: html の data-theme を変え、保存する（保存できなくても表示は変える） */
export function applyThemePreference(preference: ThemePreference): void {
  const attr = dataThemeFor(preference);
  if (attr) document.documentElement.setAttribute("data-theme", attr);
  else document.documentElement.removeAttribute("data-theme");
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // プライベートブラウズなどで保存できない。この画面の間だけ選択が効く
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useThemePreference(): [ThemePreference, (p: ThemePreference) => void] {
  const preference = useSyncExternalStore<ThemePreference>(
    subscribePreference,
    readPreference,
    () => "system",
  );
  const set = useCallback((p: ThemePreference) => applyThemePreference(p), []);
  return [preference, set];
}

function readResolved(): ResolvedTheme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return resolveTheme("system", window.matchMedia(DARK_QUERY).matches);
}

function subscribeResolved(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore<ResolvedTheme>(subscribeResolved, readResolved, () => "light");
}
