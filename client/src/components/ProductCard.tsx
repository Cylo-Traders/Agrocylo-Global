"use client";

import { ReactNode } from "react";
import Image from "next/image";
import { Heart } from "lucide-react";
import type { Product } from "@/types/product";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";

interface ProductCardProps {
  product: Product;
  /** Whether the product is in the user's favorites. */
  favorited?: boolean;
  /** Called when the user clicks the favorite button. */
  onToggleFavorite?: (productId: string) => void;
  /** Action slot — usually Edit/Delete buttons rendered by the dashboard. */
  children?: ReactNode;
}

export function ProductCard({ product, favorited, onToggleFavorite, children }: ProductCardProps) {
  const priceDisplay = `${Number(product.price_per_unit).toLocaleString()} ${
    product.currency
  }`;

  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md">
      <div className="bg-secondary relative aspect-video w-full overflow-hidden">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover transition-transform hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="grid h-full w-full place-content-center text-5xl">
            🌱
          </div>
        )}

        {onToggleFavorite && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-2 top-2 size-9 rounded-full bg-background/60 backdrop-blur-sm hover:bg-background/80"
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
            onClick={(e) => {
              e.preventDefault();
              onToggleFavorite(product.id);
            }}
          >
            <Heart
              className={cn(
                "size-4 transition-colors",
                favorited
                  ? "fill-destructive text-destructive"
                  : "text-muted-foreground",
              )}
            />
          </Button>
        )}

        <Badge
          variant={product.is_available ? "success" : "outline"}
          className="bg-background/90 absolute right-2 top-2 backdrop-blur-sm"
        >
          {product.is_available ? "Listed" : "Hidden"}
        </Badge>
      </div>

      <CardHeader className="px-4 pt-4">
        <div className="space-y-1">
          <h3 className="line-clamp-1 text-base font-semibold">
            {product.name}
          </h3>
          <p className="text-muted-foreground text-xs">
            {product.category || "Uncategorized"} · {product.location}
          </p>
        </div>
      </CardHeader>

      <CardContent className="flex grow flex-col gap-3 px-4 pb-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-primary text-xl font-bold">{priceDisplay}</p>
            <p className="text-muted-foreground text-xs">
              per {product.unit}
            </p>
          </div>
          <div className="text-right">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Stock
            </p>
            <p className="text-sm font-medium">
              {product.stock_quantity ?? "Unlimited"}
            </p>
          </div>
        </div>

        <Separator />

        <div>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
            Farmer
          </p>
          <p className="font-mono mt-0.5 text-xs">
            {formatTruncatedAddress(product.farmer_wallet)}
          </p>
        </div>

        {children && (
          <div className="mt-auto pt-2">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProductCardSkeleton() {
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden p-0">
      <Skeleton className="aspect-video w-full rounded-none" />
      <CardContent className="space-y-3 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
        <Separator />
        <Skeleton className="h-4 w-full" />
      </CardContent>
    </Card>
  );
}
