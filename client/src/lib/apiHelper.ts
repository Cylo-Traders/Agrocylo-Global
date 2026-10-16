import { API_BASE_URL } from "./apiConfig";
import {
  AUTH_EXPIRED_EVENT,
  clearAuthSession,
  getAccessToken,
} from "./authToken";

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
  cache?: RequestCache;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 15_000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 100;

function errorCodeFromResponse(
  parsed: { code?: unknown } | null,
  status: number,
): string {
  if (typeof parsed?.code === "string" && parsed.code.trim()) {
    return parsed.code;
  }
  return status === 404 ? "NOT_FOUND" : "SERVER_ERROR";
}

function normalizeUrl(base: string, path: string): string {
  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return cleanBase + cleanPath;
}

function isRetryable(status: number, method?: string): boolean {
  if (method && !["GET", "HEAD", "OPTIONS", "PUT", "DELETE"].includes(method)) {
    return false;
  }
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function getRetryDelayMs(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined) return retryAfter * 1000;
  const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.1;
  return exponential + jitter;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    cache,
    signal: externalSignal,
  } = options;

  const url = normalizeUrl(API_BASE_URL, path);
  let lastError: ApiRequestError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const combinedSignal = AbortSignal.any([
      controller.signal,
      ...(externalSignal ? [externalSignal] : []),
    ]);

    try {
      const accessToken = getAccessToken();
      const res = await fetch(url, {
        method,
        headers: {
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...headers,
        },
        body:
          body == null
            ? undefined
            : body instanceof FormData
              ? body
              : JSON.stringify(body),
        signal: combinedSignal,
        cache,
      });

      if (!res.ok) {
        let parsed: { message?: string; title?: string; code?: string } | null =
          null;
        try {
          parsed = await res.json();
        } catch {
          // ignore
        }
        if (res.status === 401 && accessToken && typeof window !== "undefined") {
          clearAuthSession();
          window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }

        const error = new ApiRequestError({
          code: errorCodeFromResponse(parsed, res.status),
          message:
            parsed?.message ||
            parsed?.title ||
            `Request failed with status ${res.status}`,
          status: res.status,
          details: parsed,
        });

        if (isRetryable(res.status, method) && attempt < MAX_RETRIES) {
          lastError = error;
          const retryAfter = res.headers.get("Retry-After")
            ? parseInt(res.headers.get("Retry-After")!, 10)
            : undefined;
          const delayMs = getRetryDelayMs(attempt, retryAfter);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }

      if (res.status === 204 || res.status === 205) return undefined as T;

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

  if (lastError) throw lastError;
  throw new ApiRequestError({
    code: "MAX_RETRIES_EXCEEDED",
    message: "Request failed after maximum retries",
    status: 0,
  });
}

// Convenience helper functions for common API operations
export async function apiGet<T>(
  path: string,
  walletAddress?: string,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "GET",
    headers: walletAddress ? { "x-wallet-address": walletAddress } : {},
  });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  walletAddress?: string,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body,
    headers: walletAddress ? { "x-wallet-address": walletAddress } : {},
  });
}

export async function apiPut<T>(
  path: string,
  body: unknown,
  walletAddress?: string,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "PUT",
    body,
    headers: walletAddress ? { "x-wallet-address": walletAddress } : {},
  });
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  walletAddress?: string,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    body,
    headers: walletAddress ? { "x-wallet-address": walletAddress } : {},
  });
}

export async function apiDelete<T = void>(
  path: string,
  walletAddress?: string,
): Promise<T> {
  return apiRequest<T>(path, {
    method: "DELETE",
    headers: walletAddress ? { "x-wallet-address": walletAddress } : {},
  });
}
