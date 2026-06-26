import Link from "next/link";
import { formatPrice } from "@/services/productService";
import type { Product } from "@/types";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="bg-surface border border-border rounded-xl overflow-hidden hover:border-primary-400 hover:shadow-md transition-all block"
      aria-label={`View ${product.name} - ${formatPrice(product.pricePerUnit)} XLM per ${product.unit}`}
    >
      <div
        className="h-36 bg-neutral-100 flex items-center justify-center text-4xl"
        role="img"
        aria-label={
          product.imageUrl
            ? `Image of ${product.name}`
            : `Placeholder for ${product.name}`
        }
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span aria-hidden="true">🌱</span>
        )}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-foreground leading-tight">
            {product.name}
          </h3>
          <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full whitespace-nowrap">
            {product.category}
          </span>
        </div>
        <p className="text-sm text-muted line-clamp-2">{product.description}</p>
        <div className="flex items-center justify-between text-sm pt-1">
          <span className="font-medium text-foreground">
            {formatPrice(product.pricePerUnit)} XLM/{product.unit}
          </span>
          <span className="text-muted text-xs">{product.location}</span>
        </div>
        <p className="text-xs text-muted">
          {product.quantity} {product.unit}(s) available
        </p>
      </div>
    </Link>
  );
}
