// 005 T008（TR-004）: axe-core でアクセシビリティを検査する補助。明るい表示と暗い表示のそれぞれで、
// WCAG 2.2 AA のタグの違反を集め、見やすい文にして返す
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";

/** 検査する WCAG のタグ（2.2 AA までのすべて） */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

export type ColorScheme = "light" | "dark";
export const COLOR_SCHEMES: readonly ColorScheme[] = ["light", "dark"];

/**
 * 検査しない部分。地図の canvas の中は axe が読めない（図は凡例と文で補う）。
 * MapLibre の部品は、違反が出たらまず直せるかを確かめ、直せないものだけここに理由と一緒に足す
 */
const EXCLUDE: readonly string[] = [".maplibregl-canvas"];

export interface A11yViolation {
  id: string;
  impact: string | null;
  help: string;
  targets: string[];
}

/** 開いている画面を検査して、違反の一覧を返す */
export async function axeViolations(page: Page): Promise<A11yViolation[]> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_TAGS]);
  for (const selector of EXCLUDE) builder = builder.exclude(selector);
  const result = await builder.analyze();
  return result.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(" ")),
  }));
}

/** 違反を、テストの失敗の文として読める形にする */
export function formatViolations(violations: readonly A11yViolation[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact ?? "?"}): ${v.help}\n  ${v.targets.slice(0, 5).join("\n  ")}`)
    .join("\n");
}

/** 指定の表示（OS の設定をまねる）で、新しいページを開く */
export async function newPageWithScheme(browser: Browser, scheme: ColorScheme, baseURL?: string) {
  const context = await browser.newContext({ colorScheme: scheme, baseURL });
  return context.newPage();
}
