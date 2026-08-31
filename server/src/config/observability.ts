import * as Sentry from "@sentry/node";
import { initSentry, SENSITIVE_PATTERNS } from "./sentry.js";

export { SENSITIVE_PATTERNS };

/**
 * Initialize error tracking and tracing for a process type.
 *
 * Thin wrapper over the canonical `initSentry` in `config/sentry.ts` so the
 * entire repo has exactly one module that calls `Sentry.init`.
 */
export function initializeSentry(processType: "api" | "worker" | "watcher"): void {
  initSentry(processType);
}

/**
 * Start a tracing span. Ported from the removed OpenTelemetry callsite to the
 * Sentry v8 `startSpan` API; the returned object is the active Sentry span.
 */
export function createSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  requestId?: string,
) {
  return Sentry.startSpan(
    {
      name,
      op: "function",
      attributes: {
        ...attributes,
        ...(requestId && { "request_id": requestId }),
      },
    },
    (span) => span,
  );
}

/**
 * Execute a function within a traced span.
 * Any thrown error is captured to Sentry and re-thrown.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attributes: Record<string, unknown> = {},
  requestId?: string,
): Promise<T> {
  return Sentry.startSpan(
    {
      name,
      op: "function",
      attributes: {
        ...attributes,
        ...(requestId && { "request_id": requestId }),
      },
    },
    async () => {
      try {
        const result = await fn();
        return result;
      } catch (error) {
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
  );
}

/**
 * Extract and propagate trace context from request headers.
 * Used to correlate requests across process boundaries.
 */
export function extractTraceContext(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const ctx: Record<string, string> = {};

  // Extract x-request-id for correlation
  const requestId = headers["x-request-id"];
  if (typeof requestId === "string") {
    ctx["x-request-id"] = requestId;
  }

  // Extract W3C Trace Context headers
  const traceParent = headers["traceparent"];
  if (typeof traceParent === "string") {
    ctx["traceparent"] = traceParent;
  }

  return ctx;
}

/**
 * Capture an exception with request context.
 * Useful for manual error handling in async contexts.
 */
export function captureException(error: Error, context: Record<string, unknown> = {}): void {
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message with structured context.
 */
export function captureMessage(message: string, level: "fatal" | "error" | "warning" | "info" = "info"): void {
  Sentry.captureMessage(message, level);
}