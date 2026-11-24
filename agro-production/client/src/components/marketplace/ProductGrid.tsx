import { Package, Search, Heart, SlidersHorizontal } from 'lucide-react';
import { ProductCard } from '../ProductCard';
import type { Product } from '../../types';

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  searchQuery?: string;
  favoritesOnly?: boolean;
  hasActiveFilters?: boolean;
  onClearSearch?: () => void;
  onClearFavorites?: () => void;
  onClearFilters?: () => void;
}

export function ProductGrid({
  products,
  loading = false,
  searchQuery = '',
  favoritesOnly = false,
  hasActiveFilters = false,
  onClearSearch,
  onClearFavorites,
  onClearFilters,
}: ProductGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <p role="status" className="sr-only">Loading products...</p>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            data-testid="product-skeleton"
            className="h-72 animate-pulse rounded-lg bg-gray-200"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery) {
      return (
        <EmptyState
          icon={<Search className="h-10 w-10" aria-hidden="true" />}
          title="No products match your search"
          description={`We couldn't find any products for "${trimmedQuery}". Try a different search term.`}
          actionLabel="Clear search"
          onAction={onClearSearch}
        />
      );
    }

    if (favoritesOnly) {
      return (
        <EmptyState
          icon={<Heart className="h-10 w-10" aria-hidden="true" />}
          title="No matching favorites"
          description="None of your saved favorites match the current filters. Exit favorites-only mode to see all products."
          actionLabel="Exit favorites-only"
          onAction={onClearFavorites}
        />
      );
    }

    if (hasActiveFilters) {
      return (
        <EmptyState
          icon={<SlidersHorizontal className="h-10 w-10" aria-hidden="true" />}
          title="No products match your filters"
          description="No products match the selected filters. Try clearing them to see more results."
          actionLabel="Clear filters"
          onAction={onClearFilters}
        />
      );
    }

    return (
      <EmptyState
        icon={<Package className="h-10 w-10" aria-hidden="true" />}
        title="No products available"
        description="There are no products in the marketplace yet. Check back soon."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-12 text-center sm:px-6 sm:py-16"
    >
      <div className="mb-4 text-gray-400">{icon}</div>
      <h3 className="text-base font-semibold text-gray-900 sm:text-lg">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-gray-600">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
