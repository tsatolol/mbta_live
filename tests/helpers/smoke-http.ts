// Cloud Run / IAP の切り替え直後の一時エラーだけを、上限を決めて再試行する。
// API の内容・認証の正否は呼び出し側のスモークテストで検証し、再試行で隠さない。
const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const ATTEMPTS = 3;
const TIMEOUT_MS = 5_000;
const INTERVAL_MS = 5_000;

interface Dependencies {
  fetch: typeof fetch;
  wait: (ms: number) => Promise<void>;
  report: (message: string) => void;
}

const defaults: Dependencies = {
  fetch: (url, init) => fetch(url, init),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  report: (message) => console.warn(message),
};

function isConnectionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name))
  );
}

export async function smokeGet(
  url: string,
  init: Omit<RequestInit, "method" | "body" | "signal"> = {},
  deps: Dependencies = defaults,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        ...init,
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (!isConnectionError(error) || attempt === ATTEMPTS) throw error;
      // エラー本文・URL のクエリ・認証ヘッダーは記録しない。
      deps.report(
        `Smoke GET ${new URL(url).pathname}: connection/timeout; retry ${attempt}/${ATTEMPTS - 1} in ${INTERVAL_MS} ms`,
      );
      await deps.wait(INTERVAL_MS);
      continue;
    }
    if (!RETRY_STATUSES.has(response.status) || attempt === ATTEMPTS) return response;
    deps.report(
      `Smoke GET ${new URL(url).pathname}: HTTP ${response.status}; retry ${attempt}/${ATTEMPTS - 1} in ${INTERVAL_MS} ms`,
    );
    await response.body?.cancel();
    await deps.wait(INTERVAL_MS);
  }
}
