// JSON:API 形式の応答の解析。行ごとに検証し、スキーマに合わない行はスキップする（憲章の原則 III）。
import { z } from "zod";

export const resourceIdentifierSchema = z.object({ id: z.string(), type: z.string() });

/** 対 1 のリレーション（data が null のこともある） */
export const toOneSchema = z.object({ data: resourceIdentifierSchema.nullable() });

/** 対多のリレーション */
export const toManySchema = z.object({ data: z.array(resourceIdentifierSchema) });

const documentSchema = z.object({
  data: z.array(z.unknown()),
  included: z.array(z.unknown()).optional(),
});

export interface RejectedRow {
  index: number;
  id: string | null;
  message: string;
}

export interface ParsedDocument<T> {
  rows: T[];
  rejected: RejectedRow[];
  /** included はまだ検証していない。使う側がスキーマで解析する */
  included: unknown[];
}

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

function idOf(row: unknown): string | null {
  if (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string") {
    return row.id;
  }
  return null;
}

function summarize(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * JSON:API の文書を解析する。文書全体の形が違えば InvalidDocumentError を投げる。
 * data の各行は rowSchema で検証し、合わない行は rejected に入れて残りを返す。
 */
export function parseDocument<S extends z.ZodType>(
  body: unknown,
  rowSchema: S,
): ParsedDocument<z.output<S>> {
  const doc = documentSchema.safeParse(body);
  if (!doc.success) {
    throw new InvalidDocumentError(
      `JSON:API の文書の形が正しくありません: ${summarize(doc.error)}`,
    );
  }
  const rows: z.output<S>[] = [];
  const rejected: RejectedRow[] = [];
  doc.data.data.forEach((row, index) => {
    const parsed = rowSchema.safeParse(row);
    if (parsed.success) rows.push(parsed.data);
    else rejected.push({ index, id: idOf(row), message: summarize(parsed.error) });
  });
  return { rows, rejected, included: doc.data.included ?? [] };
}
