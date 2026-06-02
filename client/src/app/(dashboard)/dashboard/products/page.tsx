"use client";

import { useState } from "react";
import Image from "next/image";
import { Plus, Pencil, Trash2, MoreHorizontal, Eye, EyeOff } from "lucide-react";
import { ColumnDef } from "@tanstack/react-table";

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
import { useWallet } from "@/hooks/useWallet";
import {
  useMyProducts,
  useDeleteProduct,
  useUpdateProduct,
} from "@/hooks/queries/useProducts";
import ProductFormModal from "@/components/ProductFormModal";
import type { Product } from "@/types/product";

export default function FarmerProductsDashboard() {
  const { address } = useWallet();
  const { data, isLoading, error } = useMyProducts();
  const deleteProduct = useDeleteProduct();
  const updateProduct = useUpdateProduct();

  const products = data?.items ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  function openAdd() {
    setModalMode("add");
    setEditingProduct(null);
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setModalMode("edit");
    setEditingProduct(p);
    setModalOpen(true);
  }

  async function handleToggleAvailability(p: Product) {
    await updateProduct.mutateAsync({
      id: p.id,
      input: { is_available: !p.is_available },
    });
  }

  async function handleDelete(p: Product) {
    const ok = window.confirm(
      `Delete "${p.name}"? This will soft-delete the product.`,
    );
    if (!ok) return;
    await deleteProduct.mutateAsync(p.id);
  }

  const columns: ColumnDef<Product>[] = [
    {
      id: "product",
      header: "Product",
      accessorFn: (row) => `${row.name} ${row.category} ${row.location}`,
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
              <span className="text-muted-foreground text-xs">{p.location}</span>
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
      accessorKey: "stock_quantity",
      header: "Stock",
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.stock_quantity ?? "—"}
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
      cell: ({ row }) => {
        const p = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEdit(p)}>
                <Pencil className="size-3.5" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleToggleAvailability(p)}>
                {p.is_available ? (
                  <>
                    <EyeOff className="size-3.5" />
                    Hide listing
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" />
                    Show listing
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleDelete(p)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Products"
        description="Manage your listings and visibility from your farmer dashboard."
      >
        <Button onClick={openAdd}>
          <Plus className="size-4" />
          Add Product
        </Button>
      </PageHeader>

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
          <h3 className="text-lg font-semibold">No products yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Click &quot;Add Product&quot; to create your first listing.
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={products}
          searchPlaceholder="Search products by name, category, or location…"
        />
      )}

      <ProductFormModal
        open={modalOpen}
        mode={modalMode}
        walletAddress={address ?? ""}
        initialProduct={editingProduct}
        onClose={() => setModalOpen(false)}
        onSuccess={async () => {
          // useMutation invalidates queries on success — nothing more to do here.
        }}
      />
    </div>
  );
}
