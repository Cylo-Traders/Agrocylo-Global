"use client";

interface ErrorMessageProps {
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
}

export default function ErrorMessage({
  message,
  onRetry,
  retrying = false,
}: ErrorMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
        <svg
          className="h-6 w-6 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
          Something went wrong
        </h3>
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {message}
        </p>
      </div>

      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {retrying ? (
            <>
              <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              Retrying...
            </>
          ) : (
            <>
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Try Again
            </>
          )}
        </button>
      )}
    </div>
  );
}
