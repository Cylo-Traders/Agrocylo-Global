"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";

type ViewMode = "grid" | "list";

export interface ProductGridProps {
  products: Product[];
  isLoading?: boolean;
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  page: number;
  pageSize: number;
  totalKnown?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  emptyMessage?: string;
  renderActions?: (product: Product) => React.ReactNode;
}

const PAGE_SIZES = [12, 24, 48];

export function ProductGrid({
  products,
  isLoading = false,
  view,
  onViewChange,
  page,
  pageSize,
  totalKnown,
  onPageChange,
  onPageSizeChange,
  emptyMessage = "No products match your filters.",
  renderActions,
}: ProductGridProps) {
  const total = totalKnown ?? products.length;
  const hasNextPage = products.length === pageSize;
  const start = (page - 1) * pageSize + (products.length > 0 ? 1 : 0);
  const end = (page - 1) * pageSize + products.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {isLoading
            ? "Loading…"
            : products.length === 0
              ? "0 results"
              : totalKnown !== undefined
                ? `Showing ${start}–${end} of ${total}`
                : `Showing ${products.length} result${products.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(v: string) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="bg-card flex items-center gap-1 rounded-md border p-0.5">
            <Button
              size="icon"
              variant={view === "grid" ? "secondary" : "ghost"}
              className="size-8"
              onClick={() => onViewChange("grid")}
              aria-label="Grid view"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              size="icon"
              variant={view === "list" ? "secondary" : "ghost"}
              className="size-8"
              onClick={() => onViewChange("list")}
              aria-label="List view"
            >
              <ListIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div
          className={
            view === "grid"
              ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
              : "space-y-3"
          }
        >
          {Array.from({ length: pageSize }).map((_, i) => (
            <div
              key={i}
              className="bg-card flex flex-col gap-3 rounded-2xl border p-4"
            >
              <Skeleton className={cn(view === "grid" ? "h-48" : "h-24", "w-full rounded-xl")} />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="bg-card rounded-2xl border p-10 text-center">
          <h3 className="text-lg font-semibold">No products yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">{emptyMessage}</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <GridCard key={p.id} product={p} renderActions={renderActions} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((p) => (
            <ListRow key={p.id} product={p} renderActions={renderActions} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function GridCard({
  product,
  renderActions,
}: {
  product: Product;
  renderActions?: (p: Product) => React.ReactNode;
}) {
  return (
    <article className="bg-card group flex flex-col overflow-hidden rounded-2xl border transition hover:shadow-md">
      <Link
        href={`/market/${product.id}`}
        className="bg-secondary relative aspect-[4/3] overflow-hidden"
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover transition group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="grid size-full place-content-center text-5xl">🌱</div>
        )}
        {product.category && (
          <Badge className="absolute left-3 top-3" variant="secondary">
            {product.category}
          </Badge>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <Link
            href={`/market/${product.id}`}
            className="hover:text-primary font-semibold"
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
        {renderActions && (
          <div className="mt-auto pt-1">{renderActions(product)}</div>
        )}
      </div>
    </article>
  );
}

function ListRow({
  product,
  renderActions,
}: {
  product: Product;
  renderActions?: (p: Product) => React.ReactNode;
}) {
  return (
    <article className="bg-card flex flex-col gap-4 rounded-2xl border p-4 transition hover:shadow-sm sm:flex-row sm:items-center">
      <Link
        href={`/market/${product.id}`}
        className="bg-secondary relative aspect-[4/3] w-full overflow-hidden rounded-xl sm:w-40 sm:shrink-0"
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 160px"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="grid size-full place-content-center text-4xl">🌱</div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link
              href={`/market/${product.id}`}
              className="hover:text-primary text-base font-semibold"
            >
              {product.name}
            </Link>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {product.location}
            </p>
          </div>
          {product.category && (
            <Badge variant="secondary">{product.category}</Badge>
          )}
        </div>
        {product.description && (
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {product.description}
          </p>
        )}
        <div className="flex flex-wrap items-baseline justify-between gap-3 pt-1">
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
        {renderActions && <div className="pt-1">{renderActions(product)}</div>}
      </div>
    </article>
  );
}

export default ProductGrid;
