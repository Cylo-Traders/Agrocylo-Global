/* Typed API client with centralized error handling, retry logic, and timeout support
   - Allows injecting a fetch implementation for testing/mocking
   - NetworkError is thrown for connectivity failures (no response received)
   - ApiError is thrown when the server responds with a non-2xx status
   - Retries use exponential backoff and only apply to network errors and 5xx responses on safe methods
*/

/** Thrown when no response is received (DNS failure, timeout, offline, etc.) */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Thrown when the server responds with a non-2xx status code */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 300;

/** Retryable: network errors and 5xx on idempotent methods */
function isRetryable(err: unknown, method: string): boolean {
  if (err instanceof NetworkError) return true;
  if (err instanceof ApiError && err.status >= 500) {
    return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestOptions extends RequestInit {
  /** Request timeout in milliseconds (default: 15 000) */
  timeoutMs?: number;
  /** Max retry attempts on network error or 5xx (default: 3) */
  retries?: number;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Default timeout for all requests (ms) */
  defaultTimeoutMs?: number;
  /** Default max retries */
  defaultRetries?: number;
}

export class ApiClient {
  private baseUrl: string;
  private fetchImpl?: typeof fetch;
  private defaultTimeoutMs: number;
  private defaultRetries: number;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
    this.fetchImpl = opts.fetchImpl;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultRetries = opts.defaultRetries ?? DEFAULT_RETRIES;
  }

  private async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { timeoutMs = this.defaultTimeoutMs, retries = this.defaultRetries, ...init } = options;
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const method = init.method ?? "GET";
    const fetcher = this.fetchImpl ?? fetch.bind(globalThis);

    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        console.debug(`[api] retry ${attempt}/${retries} in ${delay}ms — ${method} ${url}`);
        await sleep(delay);
      }

      const controller = new AbortController();
      const externalSignal = options.signal;
      const abortListener = externalSignal
        ? () => controller.abort(externalSignal.reason)
        : undefined;
      if (abortListener) {
        if (externalSignal?.aborted) abortListener();
        else externalSignal?.addEventListener("abort", abortListener, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        console.debug(`[api] ${method} ${url}`);
        const res = await fetcher(url, { ...init, signal: controller.signal });
        clearTimeout(timer);
        if (abortListener) externalSignal?.removeEventListener("abort", abortListener);

        const ct = res.headers.get("content-type") ?? "";
        const body = ct.includes("application/json")
          ? await res.json().catch(() => null)
          : await res.text().catch(() => null);

        if (!res.ok) {
          const message =
            (body as { error?: string; message?: string } | null)?.error ??
            (body as { error?: string; message?: string } | null)?.message ??
            res.statusText ??
            `HTTP ${res.status}`;
          const err = new ApiError(res.status, message, body);
          console.error("[api][error]", { status: res.status, url, body });
          // Only retry 5xx on safe methods
          if (isRetryable(err, method) && attempt < retries) {
            lastError = err;
            continue;
          }
          throw err;
        }

        console.debug("[api][response]", { url, status: res.status });
        return body as T;
      } catch (err) {
        clearTimeout(timer);
        if (abortListener) externalSignal?.removeEventListener("abort", abortListener);

        if (externalSignal?.aborted) throw err;

        if (err instanceof ApiError) throw err; // already handled above

        // AbortError → timeout
        const isAbort = err instanceof Error && err.name === "AbortError";
        const networkErr = new NetworkError(
          isAbort ? `Request timed out after ${timeoutMs}ms` : `Network error: ${(err as Error).message}`,
          err,
        );
        console.error("[api][network]", { url, attempt, cause: err });
        lastError = networkErr;

        if (attempt >= retries) break;
        // continue loop for next retry
      }
    }

    throw lastError;
  }

  get<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  post<T = unknown>(path: string, data?: unknown, options?: RequestOptions) {
    const headers = { "Content-Type": "application/json", ...(options?.headers as Record<string, string>) };
    return this.request<T>(path, { ...options, method: "POST", headers, body: JSON.stringify(data) });
  }

  put<T = unknown>(path: string, data?: unknown, options?: RequestOptions) {
    const headers = { "Content-Type": "application/json", ...(options?.headers as Record<string, string>) };
    return this.request<T>(path, { ...options, method: "PUT", headers, body: JSON.stringify(data) });
  }

  delete<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }
}

export const api = new ApiClient();

export default api;
