"use client";

import Spinner from "./Spinner";
import ErrorMessage from "./ErrorMessage";

interface AsyncBoundaryProps {
  isLoading: boolean;
  error: string | null | undefined;
  onRetry?: () => void;
  retrying?: boolean;
  loadingLabel?: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Standardized async feedback wrapper.
 *
 * Renders a spinner while loading, an error card with retry button on
 * failure, and the children on success. Use this around any data-fetching
 * section to get consistent UX across the app.
 *
 * @example
 * <AsyncBoundary isLoading={loading} error={error} onRetry={refetch}>
 *   <ProductList products={data} />
 * </AsyncBoundary>
 */
export default function AsyncBoundary({
  isLoading,
  error,
  onRetry,
  retrying = false,
  loadingLabel,
  children,
  fallback,
}: AsyncBoundaryProps) {
  if (isLoading) {
    return fallback ?? <Spinner label={loadingLabel} />;
  }

  if (error) {
    return (
      <ErrorMessage message={error} onRetry={onRetry} retrying={retrying} />
    );
  }

  return <>{children}</>;
}
