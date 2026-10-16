"use client";

import { useEffect } from "react";
import "./globals.css";
import { reportBoundaryError } from "@/lib/errorTracking";

/**
 * Reports an error that crashed the root layout itself (Issue #756).
 * Next.js requires this file to render its own <html>/<body>.
 *
 * Errors in child routes are handled by `app/error.tsx` inside the normal
 * shell (Issue #1090); this is the last resort. The root layout's providers
 * (I18n, Theme) are gone at this point, so the copy is not localized.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <main role="alert" className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted">The error has been reported. Please try again.</p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
