import React from "react";
import type { Product } from "@/types/product";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Text,
  Badge,
} from "@/components/ui";

interface ProductCardProps {
  product: Product;
  children?: React.ReactNode; // For action buttons like Edit/Delete
}

export function ProductCard({ product, children }: ProductCardProps) {
  const priceDisplay = `${Number(product.price_per_unit).toLocaleString()} ${product.currency}`;

  return (
    <Card
      variant="elevated"
      className="h-full flex flex-col hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-border/20">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover transition-transform hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground bg-secondary/10">
            <Text variant="body" muted>
              No Image
            </Text>
          </div>
        )}
      </div>

      <CardHeader className="p-4 pb-0">
        <div className="flex justify-between items-start gap-2">
          <div>
            <CardTitle className="text-lg font-semibold line-clamp-1">
              {product.name}
            </CardTitle>
            <Text variant="body" muted className="text-xs">
              {product.category || "Uncategorized"}
            </Text>
          </div>
          <Badge variant={product.is_available ? "success" : "outline"}>
            {product.is_available ? "Listed" : "Unlisted"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-4 space-y-4 grow">
        <div className="flex justify-between items-end">
          <div>
            <Text variant="body" className="text-xl font-bold text-primary">
              {priceDisplay}
            </Text>
            <Text variant="body" muted className="text-xs">
              per {product.unit}
            </Text>
          </div>
          <div className="text-right">
            <Text variant="body" muted className="text-[10px] uppercase">
              Stock
            </Text>
            <Text variant="body" className="text-sm font-medium">
              {product.stock_quantity ?? "Unlimited"}
            </Text>
          </div>
        </div>

        <div className="pt-2 border-t border-border/40">
          <Text
            variant="body"
            muted
            className="text-[10px] uppercase tracking-wider block"
          >
            Farmer Wallet
          </Text>
          <Text variant="body" className="text-xs font-mono truncate">
            {product.farmer_wallet}
          </Text>
        </div>

        {/* Slot for Dashboard Actions (Edit/Delete) */}
        {children && <div className="pt-2">{children}</div>}
      </CardContent>
    </Card>
  );
}

export function ProductCardSkeleton() {
  return (
    <Card variant="outlined" className="h-full animate-pulse">
      <div className="aspect-video w-full bg-border/30" />
      <CardContent className="p-4 space-y-4">
        <div className="h-5 bg-border/30 rounded w-3/4" />
        <div className="h-8 bg-border/30 rounded w-1/2" />
        <div className="h-10 bg-border/20 rounded w-full" />
      </CardContent>
    </Card>
  );
}
