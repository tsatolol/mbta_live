// T030 の確認用（一時的）: 結合テストが失敗する変更をマージしても、dev にも prod にもデプロイされないことを確かめる。
// PR のチェック（pr-checks）は単体テストだけなので、この失敗はリリース用の CI（pipeline.yml の ci）で初めて見つかる。
// 確認が終わったら削除する
import { describe, expect, it } from "vitest";

describe("T030 の確認用", () => {
  it("わざと失敗する", () => {
    expect(1 + 1).toBe(3);
  });
});
