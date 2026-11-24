const API_URL = process.env.NEXT_PUBLIC_API_URL;

export type ApiErrorCode =
  | "MISSING_CONFIG"
  | "MALFORMED_CONFIG"
  | "NETWORK_ERROR"
  | "CORS_OR_NETWORK"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "SERVER_ERROR"
  | "UNKNOWN";

export class ApiRequestError extends Error {
  code: ApiErrorCode;
  status?: number;
  requestId?: string;
  origin?: string;

  constructor(
    message: string,
    code: ApiErrorCode,
    options: { status?: number; requestId?: string; origin?: string } = {}
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.origin = options.origin;
  }
}

/**
 * Resolve and validate the configured API origin.
 * Throws ApiRequestError with MISSING_CONFIG / MALFORMED_CONFIG so callers can
 * distinguish configuration problems from ordinary server errors.
 */
export function getApiOrigin(): string {
  if (!API_URL || API_URL.trim() === "") {
    throw new ApiRequestError(
      "The API URL is not configured.",
      "MISSING_CONFIG"
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(API_URL);
  } catch {
    throw new ApiRequestError(
      "The API URL is malformed.",
      "MALFORMED_CONFIG"
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiRequestError(
      "The API URL must use http or https.",
      "MALFORMED_CONFIG"
    );
  }

  return parsed.origin;
}

function mapStatusToCode(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 400 || status === 422) return "VALIDATION";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

/**
 * Human-friendly, non-technical copy for each error code.
 * Never includes secrets, tokens, or raw stack traces.
 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "MISSING_CONFIG":
        return "The app is missing its API configuration. Please contact support so the API URL can be set.";
      case "MALFORMED_CONFIG":
        return "The API configuration looks invalid. Please contact support to correct the API URL.";
      case "NETWORK_ERROR":
      case "CORS_OR_NETWORK":
        return "We couldn't reach the server. Check your connection and try again.";
      case "UNAUTHORIZED":
        return "Your session has expired. Please sign in again and retry.";
      case "FORBIDDEN":
        return "You don't have permission to do that. Contact an administrator if this seems wrong.";
      case "NOT_FOUND":
        return "The requested resource could not be found.";
      case "VALIDATION":
        return error.message || "Some details are invalid. Please review and try again.";
      case "SERVER_ERROR":
        return "The server ran into a problem. Please try again in a moment.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  return "Something went wrong. Please try again.";
}

/**
 * Log diagnostic details for maintainers: API origin and request ID only.
 * Credentials, tokens, and request bodies are never logged.
 */
export function logApiDiagnostics(error: unknown, context?: string): void {
  if (typeof console === "undefined") return;

  if (error instanceof ApiRequestError) {
    console.error("[api] request failed", {
      context,
      code: error.code,
      status: error.status,
      origin: error.origin,
      requestId: error.requestId,
    });
    return;
  }

  console.error("[api] request failed", { context, code: "UNKNOWN" });
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const origin = getApiOrigin();
  const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
  } catch (err) {
    const requestError = new ApiRequestError(
      "Network request failed.",
      "CORS_OR_NETWORK",
      { origin }
    );
    logApiDiagnostics(requestError, path);
    throw requestError;
  }

  const requestId = response.headers.get("x-request-id") || undefined;

  if (!response.ok) {
    let message = "Request failed.";
    try {
      const body = await response.json();
      if (body && typeof body.message === "string") {
        message = body.message;
      }
    } catch {
      // ignore non-JSON error bodies
    }

    const requestError = new ApiRequestError(
      message,
      mapStatusToCode(response.status),
      { status: response.status, requestId, origin }
    );
    logApiDiagnostics(requestError, path);
    throw requestError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
