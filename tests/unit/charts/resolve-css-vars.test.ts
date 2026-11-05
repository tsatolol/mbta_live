// 005 T010: グラフの設定の CSS 変数の参照を、いまの表示の値に置き換える
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCssVars } from "@/components/charts/resolve-css-vars";
import { INK, SEQUENTIAL_BLUE, SERIES_COLORS } from "@/components/charts/theme";

describe("resolveCssVars", () => {
  const lookup = (name: string) => ({ "--chart-1": "#2a78d6", "--panel": "#ffffff" })[name] ?? "";

  it("配列・オブジェクトの中の参照を置き換え、ほかの値はそのまま。元は変えない", () => {
    const option = {
      series: [
        { color: "var(--chart-1)", data: [1, 2], itemStyle: { borderColor: "var(--panel)" } },
      ],
      title: "var(--chart-1) is blue",
      n: 3,
      on: true,
      none: null,
    };
    const resolved = resolveCssVars(option, lookup);
    expect(resolved).toEqual({
      series: [{ color: "#2a78d6", data: [1, 2], itemStyle: { borderColor: "#ffffff" } }],
      title: "var(--chart-1) is blue",
      n: 3,
      on: true,
      none: null,
    });
    expect(option.series[0]!.color).toBe("var(--chart-1)");
  });

  it("値が見つからない参照は、そのまま残す", () => {
    expect(resolveCssVars("var(--unknown)", lookup)).toBe("var(--unknown)");
  });
});

describe("グラフが参照する CSS 変数", () => {
  const css = readFileSync(path.join(import.meta.dirname, "../../../src/app/globals.css"), "utf8");
  const names = [...SERIES_COLORS, ...SEQUENTIAL_BLUE, ...Object.values(INK)].map(
    (ref) => /^var\((--[a-z0-9-]+)\)$/.exec(ref)![1]!,
  );

  it.each(names)("%s は明るい表示と暗い表示の両方で定義されている", (name) => {
    const definitions = css.match(new RegExp(`\\s${name}:\\s*[^;]+;`, "g")) ?? [];
    // :root（明るい）、OS の暗い表示、data-theme="dark" の 3 か所。--ink・--panel などは 3 か所以上
    expect(definitions.length).toBeGreaterThanOrEqual(3);
  });
});
