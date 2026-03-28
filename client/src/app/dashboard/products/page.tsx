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
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Text,
} from "@/components/ui";
import ProductFormModal from "@/components/ProductFormModal";
import { ProductCard, ProductCardSkeleton } from "@/components/ProductCard";

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
      setProducts((prev) =>
        prev.map((p) =>
          p.id === product.id
            ? { ...p, is_available: product.is_available }
            : p,
        ),
      );
      alert(
        err instanceof Error ? err.message : "Failed to update availability.",
      );
    }
  }

  async function onDelete(product: Product) {
    if (!address) return;
    const ok = window.confirm(
      `Delete "${product.name}"? This will soft-delete the product.`,
    );
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
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
              Create your first listing and it will appear in the public
              catalog.
            </Text>
            <Button variant="primary" onClick={openAdd}>
              Add Product
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p) => (
            <ProductCard key={p.id} product={p}>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Text variant="body" muted className="text-sm">
                    Available
                  </Text>
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-primary cursor-pointer"
                    checked={p.is_available}
                    onChange={(e) =>
                      void onToggleAvailability(p, e.target.checked)
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(p)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(p)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </ProductCard>
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
