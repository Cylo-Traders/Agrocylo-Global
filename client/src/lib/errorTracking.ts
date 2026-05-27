export function reportError(
  error: unknown,
  context?: Record<string, unknown>,
) {
  const message =
    error instanceof Error ? error.message : error != null ? String(error) : "Unknown error";

  console.error("[ErrorTracker]", message, context ?? {});

  if (typeof window !== "undefined" && typeof (window as any).Sentry?.captureException === "function") {
    (window as any).Sentry.captureException(error, { extra: context });
  }
}

export function initErrorTracking() {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, { type: "unhandled_error" });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError(event.reason, { type: "unhandled_promise_rejection" });
  });

  console.log("[ErrorTracker] Initialized");
}
