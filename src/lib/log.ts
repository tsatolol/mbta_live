// 構造化ログ。1 行 1 JSON で標準出力に出す。Cloud Logging が severity と message を読み取る。
// 件数・解析に失敗した行数・未解決の駅 ID の数などは、004 のログベースの指標で使う。
// 秘密の値（パスワード、API キー）をフィールドに入れないこと。

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

export type LogFields = Record<string, unknown>;

export function log(severity: Severity, message: string, fields: LogFields = {}): void {
  const entry = { severity, message, time: new Date().toISOString(), ...fields };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => log("DEBUG", message, fields),
  info: (message: string, fields?: LogFields) => log("INFO", message, fields),
  warn: (message: string, fields?: LogFields) => log("WARNING", message, fields),
  error: (message: string, fields?: LogFields) => log("ERROR", message, fields),
};

/** 例外をログに出せる形にする（スタックは出すが、秘密の値を含む可能性のあるプロパティは出さない） */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorMessage: String(error) };
}
