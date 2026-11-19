import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side Sentry init (Issue #756). Must use `NEXT_PUBLIC_` prefix —
 * Next.js only inlines that prefix into the client bundle. An empty/unset
 * DSN makes the SDK safely no-op rather than throwing.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
