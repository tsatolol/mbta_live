// 005 T004（TR-003）: 表示の選択の解釈と解決、最初の描画の前に動くスクリプト
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  dataThemeFor,
  parseThemePreference,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("parseThemePreference", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    ["", "system"],
    ["DARK", "system"],
    ["sepia", "system"],
    [42, "system"],
  ])("%j は %s", (value, expected) => {
    expect(parseThemePreference(value)).toBe(expected);
  });
});

describe("resolveTheme", () => {
  it("明るい・暗いを選んでいればそれ、OS に合わせるなら OS の設定", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("dataThemeFor", () => {
  it("OS に合わせるときは data-theme を付けない（CSS のメディアクエリに任せる）", () => {
    expect(dataThemeFor("light")).toBe("light");
    expect(dataThemeFor("dark")).toBe("dark");
    expect(dataThemeFor("system")).toBeNull();
  });
});

describe("THEME_INIT_SCRIPT（最初の描画の前に動く）", () => {
  function run(stored: string | null | Error): string | null {
    let attr: string | null = null;
    const context = {
      localStorage: {
        getItem: (key: string) => {
          if (stored instanceof Error) throw stored;
          return key === THEME_STORAGE_KEY ? stored : null;
        },
      },
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            if (name === "data-theme") attr = value;
          },
        },
      },
    };
    runInNewContext(THEME_INIT_SCRIPT, context);
    return attr;
  }

  it("保存した選択を data-theme に付ける", () => {
    expect(run("dark")).toBe("dark");
    expect(run("light")).toBe("light");
  });

  it("OS に合わせる・保存がない・不正な値なら付けない", () => {
    expect(run("system")).toBeNull();
    expect(run(null)).toBeNull();
    expect(run("<script>")).toBeNull();
  });

  it("保存を読めない（プライベートブラウズなど）ときも例外を出さない", () => {
    expect(run(new Error("SecurityError"))).toBeNull();
  });
});
