"use client";

import Image from "next/image";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, EyeOff, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { useProducts, useAdminSetVisibility, useAdminDelistProduct } from "@/hooks/queries/useProducts";
import { toast } from "sonner";
import type { Product } from "@/types/product";

function ActionCell({ product }: { product: Product }) {
  const setVisibility = useAdminSetVisibility();
  const delist = useAdminDelistProduct();

  const handleToggleVisibility = () => {
    setVisibility.mutate(
      { id: product.id, isAvailable: !product.is_available },
      {
        onSuccess: () => toast(product.is_available ? "Listing hidden" : "Listing restored"),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const handleDelist = () => {
    if (!confirm(`Permanently delist "${product.name}"? This cannot be undone.`)) return;
    delist.mutate(product.id, {
      onSuccess: () => toast("Product delisted"),
      onError: (e) => toast.error((e as Error).message),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleToggleVisibility} disabled={setVisibility.isPending}>
          <EyeOff className="size-3.5" />
          {product.is_available ? "Hide listing" : "Restore listing"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleDelist}
          disabled={delist.isPending}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="size-3.5" />
          Delist (admin override)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const columns: ColumnDef<Product>[] = [
  {
    id: "product",
    header: "Product",
    accessorFn: (row) => `${row.name} ${row.category} ${row.farmer_wallet}`,
    cell: ({ row }) => {
      const p = row.original;
      return (
        <div className="flex items-center gap-3">
          <div className="bg-secondary relative size-12 overflow-hidden rounded-lg border">
            {p.image_url ? (
              <Image
                src={p.image_url}
                alt={p.name}
                fill
                className="object-cover"
                sizes="48px"
                unoptimized
              />
            ) : (
              <div className="grid size-full place-content-center text-lg">
                🌱
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{p.name}</span>
            <span className="font-mono text-muted-foreground text-xs">
              {p.farmer_wallet.slice(0, 6)}…{p.farmer_wallet.slice(-4)}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "category",
    header: "Category",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <Badge variant="secondary" className="text-xs">
        {String(getValue())}
      </Badge>
    ),
  },
  {
    accessorKey: "price_per_unit",
    header: "Price",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <span className="text-sm font-medium">
        {row.original.price_per_unit} {row.original.currency} / {row.original.unit}
      </span>
    ),
  },
  {
    accessorKey: "is_available",
    header: "Status",
    enableGlobalFilter: false,
    cell: ({ row }) => (
      <Badge variant={row.original.is_available ? "success" : "secondary"}>
        {row.original.is_available ? "Live" : "Hidden"}
      </Badge>
    ),
  },
  {
    id: "actions",
    header: "",
    enableGlobalFilter: false,
    enableSorting: false,
    cell: ({ row }) => <ActionCell product={row.original} />,
  },
];

export default function AdminProductsPage() {
  const { data, isLoading, error } = useProducts({ pageSize: 100 });
  const products = data?.items ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="All Products"
        description="Every product currently listed on the marketplace."
      />

      {error ? (
        <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-2xl border p-6">
          {error instanceof Error
            ? error.message
            : "Failed to load products."}
        </div>
      ) : isLoading ? (
        <div className="bg-card text-muted-foreground rounded-2xl border p-10 text-center text-sm">
          Loading products…
        </div>
      ) : products.length === 0 ? (
        <div className="bg-card rounded-2xl border p-10 text-center">
          <h3 className="text-lg font-semibold">No products listed</h3>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={products}
          searchPlaceholder="Search products…"
        />
      )}
    </div>
  );
}
