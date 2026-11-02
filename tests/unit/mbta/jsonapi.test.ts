// JSON:API の解析: スキーマに合わない行はスキップし、ジョブは失敗させない
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InvalidDocumentError, parseDocument } from "@/lib/mbta/jsonapi";

const rowSchema = z.object({ id: z.string(), attributes: z.object({ latitude: z.number() }) });

describe("parseDocument", () => {
  it("正しい行だけを返し、合わない行は rejected に入れる", () => {
    const body = {
      data: [
        { id: "a", attributes: { latitude: 42.3 } },
        { id: "b", attributes: { latitude: "not a number" } },
        { attributes: { latitude: 1 } },
        { id: "d", attributes: { latitude: 42.4 } },
      ],
    };
    const result = parseDocument(body, rowSchema);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "d"]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]).toMatchObject({ index: 1, id: "b" });
    expect(result.rejected[0]?.message).toContain("attributes.latitude");
    expect(result.rejected[1]).toMatchObject({ index: 2, id: null });
  });

  it("空の data（運行時間外）は 0 件で成功", () => {
    const result = parseDocument({ data: [], jsonapi: { version: "1.0" } }, rowSchema);
    expect(result.rows).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("included を返す", () => {
    const result = parseDocument({ data: [], included: [{ id: "x" }] }, rowSchema);
    expect(result.included).toEqual([{ id: "x" }]);
  });

  it("文書全体の形が違えば InvalidDocumentError", () => {
    expect(() => parseDocument({ errors: [{ status: "500" }] }, rowSchema)).toThrow(
      InvalidDocumentError,
    );
    expect(() => parseDocument(null, rowSchema)).toThrow(InvalidDocumentError);
  });
});
