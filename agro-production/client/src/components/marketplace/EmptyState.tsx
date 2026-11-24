import React from 'react';

export type EmptyStateVariant =
  | 'empty-catalog'
  | 'no-search-matches'
  | 'no-favorites'
  | 'no-filter-results';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  searchQuery?: string;
  onResetSearch?: () => void;
  onResetFavorites?: () => void;
  onResetFilters?: () => void;
}

interface EmptyStateConfig {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  variant,
  searchQuery,
  onResetSearch,
  onResetFavorites,
  onResetFilters,
}) => {
  const trimmedQuery = searchQuery?.trim();

  const configs: Record<EmptyStateVariant, EmptyStateConfig> = {
    'empty-catalog': {
      title: 'No products available yet',
      description:
        'The marketplace catalog is currently empty. Please check back later for new listings.',
    },
    'no-search-matches': {
      title: 'No products match your search',
      description: trimmedQuery
        ? `We couldn't find any products for "${trimmedQuery}". Try a different search term.`
        : "We couldn't find any products for your search. Try a different search term.",
      actionLabel: 'Clear search',
      onAction: onResetSearch,
    },
    'no-favorites': {
      title: 'No matching favorites',
      description:
        'None of your favorite products match the current search or filters. Exit favorites-only mode to see all products.',
      actionLabel: 'Show all products',
      onAction: onResetFavorites,
    },
    'no-filter-results': {
      title: 'No products match these filters',
      description:
        'Try removing some filters to broaden your results and find more products.',
      actionLabel: 'Clear filters',
      onAction: onResetFilters,
    },
  };

  const config = configs[variant];
  const showAction = Boolean(config.actionLabel && config.onAction);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center sm:px-6 sm:py-16"
    >
      <svg
        className="mb-4 h-12 w-12 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
        focusable="false"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
        />
      </svg>
      <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
        {config.title}
      </h3>
      <p className="mt-2 max-w-md text-sm text-gray-600">{config.description}</p>
      {showAction && (
        <button
          type="button"
          onClick={config.onAction}
          className="mt-5 inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
        >
          {config.actionLabel}
        </button>
      )}
    </div>
  );
};

export default EmptyState;
