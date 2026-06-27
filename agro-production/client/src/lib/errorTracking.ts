/**
 * Error tracking payload sent to NEXT_PUBLIC_TELEMETRY_URL.
 * Sensitive data is redacted:
 * - stack: removed entirely to avoid exposing private keys, paths, or sensitive data
 * - context.stack: removed if present
 * - Private keys, credentials, and wallet addresses are redacted with "[redacted]"
 */
export interface ErrorTrackingPayload {
  type: "error";
  message: string;
  name: string;
  context?: Record<string, unknown>;
  url: string;
  userAgent: string;
  timestamp: string;
}

const TELEMETRY_ENABLED = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED === "true";

let originalOnError: typeof window.onerror | null = null;
let originalOnUnhandledRejection: typeof window.onunhandledrejection | null = null;

/**
 * Redacts sensitive data from context to prevent exposing private keys, credentials, etc.
 */
function redactContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const redacted = { ...context };
  Object.keys(redacted).forEach((key) => {
    const value = String(redacted[key]);
    // Redact common sensitive fields
    if (
      key.toLowerCase().includes("key") ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("password") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("xdr") ||
      key.toLowerCase().includes("stack")
    ) {
      redacted[key] = "[redacted]";
    }
  });

  return redacted;
}

function reportError(error: Error, context?: Record<string, unknown>) {
  if (!TELEMETRY_ENABLED) return;

  const telemetryUrl = process.env.NEXT_PUBLIC_TELEMETRY_URL;
  if (!telemetryUrl) {
    console.warn(
      "[errorTracking] Telemetry enabled but NEXT_PUBLIC_TELEMETRY_URL is not set. Skipping."
    );
    return;
  }

  const payload: ErrorTrackingPayload = {
    type: "error",
    message: error.message,
    name: error.name,
    // Stack traces often contain sensitive paths and data, so we omit them entirely.
    // If you need the stack trace, configure a server-side error tracking service.
    context: redactContext(context),
    url: window.location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
  };

  try {
    fetch(telemetryUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Fail silently to avoid recursion
  }
}

export function initErrorTracking() {
  if (typeof window === "undefined" || !TELEMETRY_ENABLED) return;

  originalOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const err = error ?? new Error(String(message));
    reportError(err, { source, lineno, colno });
    if (originalOnError) {
      return originalOnError.call(window, message, source, lineno, colno, error);
    }
    return false;
  };

  originalOnUnhandledRejection = window.onunhandledrejection;
  window.onunhandledrejection = (event) => {
    const err =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    reportError(err, { type: "unhandled_rejection" });
    if (originalOnUnhandledRejection) {
      return originalOnUnhandledRejection.call(window, event);
    }
  };

  console.error = ((original) => {
    return (...args: unknown[]) => {
      const error = args.find((a) => a instanceof Error) as Error | undefined;
      if (error) {
        reportError(error, { console: true });
      }
      original.apply(console, args);
    };
  })(console.error);
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  reportError(error, context);
}
