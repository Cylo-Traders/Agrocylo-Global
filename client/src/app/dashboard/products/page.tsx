"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { WalletContext } from "@/context/WalletContext";
import type { Product } from "@/types/product";
import {
  listProducts,
  softDeleteProduct,
  updateProduct,
} from "@/services/productService";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Text,
} from "@/components/ui";
import ProductFormModal from "@/components/ProductFormModal";

function formatMoney(price: string) {
  const n = Number(price);
  if (Number.isNaN(n)) return price;
  return n.toString();
}

export default function FarmerProductsDashboard() {
  const { address, connected } = useContext(WalletContext);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const dashboardTitle = useMemo(() => "Products", []);

  async function refresh() {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listProducts({
        farmer: address,
        includeUnavailable: true,
        pageSize: 100,
      });
      setProducts(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!connected || !address) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, address]);

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

  async function onToggleAvailability(product: Product, next: boolean) {
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, is_available: next } : p)),
    );
    try {
      if (!address) throw new Error("Wallet not connected.");
      await updateProduct(address, product.id, { is_available: next });
    } catch (err) {
      // revert optimistic change
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id ? { ...p, is_available: product.is_available } : p,
        ),
      );
      alert(err instanceof Error ? err.message : "Failed to update availability.");
    }
  }

  async function onDelete(product: Product) {
    if (!address) return;
    const ok = window.confirm(`Delete "${product.name}"? This will soft-delete the product.`);
    if (!ok) return;
    try {
      await softDeleteProduct(address, product.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete product.");
    }
  }

  if (!connected) {
    return (
      <Container size="lg" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>{dashboardTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <Text variant="body" muted>
              Connect your wallet to manage your product catalog.
            </Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <Text variant="h2" as="h2">
            {dashboardTitle}
          </Text>
          <Text variant="body" muted className="block mt-1">
            Manage your listings from your farmer dashboard.
          </Text>
        </div>
        <Button variant="primary" onClick={openAdd}>
          Add Product
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} variant="outlined" padding="md">
              <CardContent className="space-y-3">
                <div className="h-24 bg-border/30 rounded-lg" />
                <div className="h-4 bg-border/30 rounded w-3/4" />
                <div className="h-4 bg-border/30 rounded w-1/2" />
                <div className="h-9 bg-border/30 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card variant="elevated" padding="lg">
          <CardContent>
            <Text variant="body" className="text-error">
              {error}
            </Text>
          </CardContent>
        </Card>
      ) : products.length === 0 ? (
        <Card variant="elevated" padding="lg">
          <CardContent className="py-10 text-center space-y-3">
            <Text variant="h3" as="h3">
              No products yet
            </Text>
            <Text variant="body" muted>
              Create your first listing and it will appear in the public catalog.
            </Text>
            <Button variant="primary" onClick={openAdd}>
              Add Product
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {products.map((p) => (
            <Card key={p.id} variant="elevated" padding="md">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image_url}
                      alt={p.name}
                      className="w-20 h-20 object-cover rounded-lg border border-border/60"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-lg border border-border/60 bg-border/20" />
                  )}
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <div className="mt-1 flex flex-wrap gap-2 items-center">
                      <Badge variant={p.is_available ? "success" : "outline"}>
                        {p.is_available ? "Listed" : "Unlisted"}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={() => openEdit(p)}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => onDelete(p)}>
                    Delete
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Text variant="body" muted className="text-sm">
                      Price
                    </Text>
                    <Text variant="body" className="font-medium">
                      {formatMoney(p.price_per_unit)} {p.currency}
                    </Text>
                    <Text variant="body" muted className="text-sm">
                      per {p.unit}
                    </Text>
                  </div>
                  <div>
                    <Text variant="body" muted className="text-sm">
                      Stock
                    </Text>
                    <Text variant="body" className="font-medium">
                      {p.stock_quantity ? p.stock_quantity : "Unlimited"}
                    </Text>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Text variant="body" muted>
                    Availability
                  </Text>
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={p.is_available}
                      onChange={(e) => void onToggleAvailability(p, e.target.checked)}
                    />
                    <Text variant="body" muted>
                      {p.is_available ? "Listed" : "Unlisted"}
                    </Text>
                  </label>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProductFormModal
        open={modalOpen}
        mode={modalMode}
        walletAddress={address ?? ""}
        initialProduct={editingProduct}
        onClose={() => setModalOpen(false)}
        onSuccess={async () => {
          await refresh();
        }}
      />
    </Container>
  );
}

