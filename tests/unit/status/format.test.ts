// 稼働状況の画面の表示用の関数
import { describe, expect, it } from "vitest";
import { agoLabel, countsLabel, durationLabel, rowCountLabel } from "@/components/status/format";

const now = new Date("2026-11-02T15:20:00Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

describe("agoLabel", () => {
  it("経過時間を読みやすくする", () => {
    expect(agoLabel(ago(30), now)).toBe("just now");
    expect(agoLabel(ago(-5), now)).toBe("just now");
    expect(agoLabel(ago(4 * 60 + 59), now)).toBe("4 min ago");
    expect(agoLabel(ago(3 * 3600), now)).toBe("3 h ago");
    expect(agoLabel(ago(3 * 86400), now)).toBe("3 days ago");
  });
});

describe("durationLabel", () => {
  it("実行時間（秒）。終わっていなければ null", () => {
    expect(durationLabel(ago(10), ago(7.55))).toBe("2.5 s");
    expect(durationLabel(ago(10), null)).toBeNull();
  });
});

describe("rowCountLabel", () => {
  it("3 桁区切りで、推定値には ~ を付ける", () => {
    expect(rowCountLabel(1234567, true)).toBe("~1,234,567");
    expect(rowCountLabel(8, false)).toBe("8");
  });
});

describe("countsLabel", () => {
  it("指定の項目だけを並べる", () => {
    expect(
      countsLabel({ vehicles: 106, predictions: 2278, requests: 3 }, [
        "vehicles",
        "predictions",
        "alerts",
      ]),
    ).toBe("vehicles 106 · predictions 2,278");
    expect(countsLabel(null, ["vehicles"])).toBe("");
  });
});
