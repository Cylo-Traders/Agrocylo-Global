"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Product {
  id: string;
  name: string;
  category: string;
  location: string;
  price_per_unit: number;
  currency: string;
  unit: string;
  stock_quantity?: number;
  image_url?: string;
}

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  toggleFavorite: (id: string) => void;
  currentQty: number;
  connected: boolean;
  setQuantityForProduct: (id: string, qty: number) => void;
}

export function ProductCard({
  product,
  isFavorite,
  toggleFavorite,
  currentQty,
  connected,
  setQuantityForProduct,
}: ProductCardProps) {
  return (
    <article
      className="bg-card group flex flex-col overflow-hidden rounded-2xl border transition hover:shadow-md"
    >
      <Link
        href={`/market/${product.id}`}
        className="relative aspect-[4/3] overflow-hidden bg-secondary"
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-content-center text-5xl">
            🌱
          </div>
        )}
        <Badge className="absolute left-3 top-3" variant="secondary">
          {product.category}
        </Badge>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(product.id);
          }}
          className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-background/60 backdrop-blur-sm transition-colors hover:bg-background/80"
          aria-label={
            isFavorite
              ? "Remove from favorites"
              : "Add to favorites"
          }
        >
          <Heart
            className={cn(
              "size-4",
              isFavorite
                ? "fill-destructive text-destructive"
                : "text-muted-foreground",
            )}
          />
        </button>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <Link
            href={`/market/${product.id}`}
            className="font-semibold hover:text-primary"
          >
            {product.name}
          </Link>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {product.location}
          </p>
        </div>

        <div className="flex items-baseline justify-between">
          <p className="text-lg font-bold">
            {product.price_per_unit}{" "}
            <span className="text-muted-foreground text-sm font-medium">
              {product.currency} / {product.unit}
            </span>
          </p>
          <p className="text-muted-foreground text-xs">
            {product.stock_quantity ?? "Unlimited"} in stock
          </p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {currentQty > 0 ? (
            <div className="bg-secondary flex items-center gap-1 rounded-full p-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-11 rounded-full"
                disabled={!connected}
                onClick={() => setQuantityForProduct(product.id, currentQty - 1)}
              >
                -
              </Button>
              <span className="min-w-6 text-center text-sm font-medium">
                {currentQty}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-11 rounded-full"
                disabled={!connected}
                onClick={() => setQuantityForProduct(product.id, currentQty + 1)}
              >
                +
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={!connected}
              onClick={() => setQuantityForProduct(product.id, 1)}
              className="flex-1"
            >
              {connected ? "Add to cart" : "Connect to buy"}
            </Button>
          )}

          <Link
            href={`/market/${product.id}`}
            className="text-muted-foreground hover:text-foreground text-xs font-medium"
          >
            View
          </Link>
        </div>
      </div>
    </article>
  );
}
