// 表示の明るさの選択（005 FR-014）。純粋関数と、最初の描画の前に動く小さなスクリプト。
// 選択はブラウザの localStorage にだけ残す（サーバーには送らない）。research.md の「暗い表示と切り替え」

/** localStorage のキー */
export const THEME_STORAGE_KEY = "mbta-live:theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

/** 保存した値を読む。決まった 3 つ以外（読めない、不正）は「OS に合わせる」 */
export function parseThemePreference(value: unknown): ThemePreference {
  return (THEME_PREFERENCES as readonly unknown[]).includes(value)
    ? (value as ThemePreference)
    : "system";
}

/** 実際に使う表示 */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** html に付ける data-theme。OS に合わせるときは付けない（CSS のメディアクエリに任せる） */
export function dataThemeFor(preference: ThemePreference): ResolvedTheme | null {
  return preference === "system" ? null : preference;
}

/**
 * ルートの layout の <head> に置くスクリプト。React が動く前、最初の描画の前に data-theme を付けて、
 * 違う表示が一瞬出るのを防ぐ。保存を読めない・不正な値なら何もしない（OS に合わせる）
 */
export const THEME_INIT_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;
