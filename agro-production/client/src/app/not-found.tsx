"use client";

import Link from "next/link";
import { useI18n } from "@/context/I18nContext";

/**
 * Branded 404 for any URL no route matches, and for `notFound()` calls without
 * a closer not-found boundary (Issue #1090). Renders inside the root layout,
 * so navigation and theme stay in place. Client component only because the
 * locale lives in I18nContext.
 */
export default function NotFound() {
  const { t } = useI18n();

  return (
    <section
      aria-labelledby="not-found-title"
      className="mx-auto max-w-xl rounded-xl border border-border p-10 text-center space-y-4"
    >
      <p aria-hidden="true" className="text-5xl font-bold text-primary-600">
        404
      </p>
      <h1 id="not-found-title" className="text-2xl font-bold text-foreground">
        {t("errors.notFound.title", "Page not found")}
      </h1>
      <p className="text-muted">
        {t(
          "errors.notFound.description",
          "The page you're looking for doesn't exist or may have been moved."
        )}
      </p>
      <nav aria-label={t("errors.notFound.linksLabel", "Helpful links")}>
        <ul className="flex flex-wrap justify-center gap-2 pt-2">
          <li>
            <Link
              href="/home"
              className="inline-block rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              {t("errors.notFound.home", "Go home")}
            </Link>
          </li>
          <li>
            <Link
              href="/marketplace"
              className="inline-block rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
            >
              {t("errors.notFound.marketplace", "Browse the marketplace")}
            </Link>
          </li>
          <li>
            <Link
              href="/campaigns"
              className="inline-block rounded-lg border border-border px-5 py-2 text-sm font-medium text-foreground hover:bg-surface transition-colors"
            >
              {t("errors.notFound.campaigns", "View campaigns")}
            </Link>
          </li>
        </ul>
      </nav>
    </section>
  );
}
