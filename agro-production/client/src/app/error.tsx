"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useI18n } from "@/context/I18nContext";
import { reportBoundaryError } from "@/lib/errorTracking";

/**
 * App-level route error boundary (Issue #1090).
 *
 * Catches errors thrown by any route below the root layout, so the NavBar and
 * providers stay mounted and the user can retry in place. Errors in the root
 * layout itself still fall through to `global-error.tsx`. Route-specific
 * boundaries (campaigns/[id], product/[id]) take precedence for their subtrees.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    reportBoundaryError(error, "app");
  }, [error]);

  // Move focus to the heading so keyboard and screen-reader users land on the
  // error instead of wherever focus was in the page that crashed.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const isDevelopment = process.env.NODE_ENV === "development";

  return (
    <section
      role="alert"
      aria-labelledby="route-error-title"
      className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-8 text-center space-y-4"
    >
      <h1
        id="route-error-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold text-foreground focus:outline-none"
      >
        {t("errors.boundary.title", "Something went wrong")}
      </h1>
      <p className="text-sm text-muted">
        {t(
          "errors.boundary.description",
          "This page hit an unexpected error. It has been reported. You can try again or go back to the home page."
        )}
      </p>
      {error.digest && (
        <p className="text-xs text-muted">
          {t("errors.boundary.reference", "Reference")}: <code>{error.digest}</code>
        </p>
      )}
      {isDevelopment && (
        <details className="text-left">
          <summary className="cursor-pointer text-xs text-muted">
            {t("errors.boundary.details", "Error details (development only)")}
          </summary>
          <pre
            data-testid="route-error-details"
            className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 text-xs text-error"
          >
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          {t("errors.boundary.retry", "Try again")}
        </button>
        <Link
          href="/home"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background transition-colors"
        >
          {t("errors.boundary.home", "Go home")}
        </Link>
      </div>
    </section>
  );
}
