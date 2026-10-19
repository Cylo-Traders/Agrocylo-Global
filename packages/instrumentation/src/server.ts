import * as Sentry from "@sentry/nextjs";

/**
 * Server/edge-side Sentry init (Issue #756). An empty/unset `SENTRY_DSN`
 * makes the SDK safely no-op rather than throwing, so this runs
 * unconditionally in every environment — it only actually reports anywhere
 * an operator has configured a real DSN.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
