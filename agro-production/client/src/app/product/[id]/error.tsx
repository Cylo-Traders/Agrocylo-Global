"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
        <Link href="/marketplace" className="hover:text-foreground">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Error</span>
      </nav>
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 space-y-4">
        <h1 className="text-xl font-bold text-red-800">Something went wrong</h1>
        <p className="text-sm text-red-700">
          {error.message || "Failed to load the product. Please try again."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/marketplace"
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 transition-colors"
          >
            Back to Marketplace
          </Link>
        </div>
      </div>
    </div>
  );
}
