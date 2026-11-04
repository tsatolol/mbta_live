// 画面から内部 API を呼ぶ: キャッシュせずに取得し、共有の zod スキーマで解析する
export class ApiError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} returned ${status}`);
  }
}

export async function fetchJson<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new ApiError(url, res.status);
  return parse(await res.json());
}
