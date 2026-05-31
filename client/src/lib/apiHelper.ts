import { API_BASE_URL } from "./apiConfig";

export interface ApiError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(err: ApiError) {
    super(err.message);
    this.name = "ApiRequestError";
    this.code = err.code;
    this.status = err.status;
    this.details = err.details;
  }
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 15_000;

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", headers = {}, body, timeout = DEFAULT_TIMEOUT } = options;

  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let parsed: { message?: string; title?: string; code?: string } | null = null;
      try {
        parsed = await res.json();
      } catch {
        // ignore
      }
      throw new ApiRequestError({
        code: parsed?.code ?? res.status === 404 ? "NOT_FOUND" : "SERVER_ERROR",
        message: parsed?.message || parsed?.title || `Request failed with status ${res.status}`,
        status: res.status,
        details: parsed,
      });
    }

    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiRequestError({
        code: "TIMEOUT",
        message: `Request timed out after ${timeout}ms`,
        status: 0,
      });
    }
    throw new ApiRequestError({
      code: "NETWORK_ERROR",
      message: err instanceof Error ? err.message : "Network request failed",
      status: 0,
    });
  } finally {
    clearTimeout(timer);
  }
}
