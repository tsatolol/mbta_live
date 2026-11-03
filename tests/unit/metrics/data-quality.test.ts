// 004 FR-013: データ品質の指標
import { describe, expect, it } from "vitest";
import { rejectedRowRatio } from "@/lib/metrics/data-quality";

describe("rejectedRowRatio", () => {
  it("解析に失敗した行の割合を返す", () => {
    expect(rejectedRowRatio(99, 1)).toBe(0.01);
    expect(rejectedRowRatio(2278, 0)).toBe(0);
  });

  it("行がなければ 0（0 で割らない）", () => {
    expect(rejectedRowRatio(0, 0)).toBe(0);
  });

  it("すべて失敗なら 1", () => {
    expect(rejectedRowRatio(0, 5)).toBe(1);
  });
});
