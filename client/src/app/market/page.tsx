"use client";

import React, { useContext, useEffect, useMemo, useState } from "react";
import { WalletContext } from "@/context/WalletContext";
import type { Product, ProductCategory } from "@/types/product";
import { listProducts } from "@/services/productService";
import { useCart } from "@/context/CartContext";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Input,
  Text,
} from "@/components/ui";
import { PriceChart } from "@/components/PriceChart";
import { trackEvent } from "@/lib/analytics";

const CATEGORIES: Array<ProductCategory | "All"> = [
  "All",
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
];

export default function MarketPage() {
  const { connected } = useContext(WalletContext);
  const { cart, setQuantityForProduct } = useCart();

  const [category, setCategory] = useState<ProductCategory | "All">("All");
  const [search, setSearch] = useState("");

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await listProducts({
          pageSize: 50,
          category: category === "All" ? undefined : category,
          includeUnavailable: false,
        });
        if (cancelled) return;
        setProducts(result.items);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load products.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [category]);

  const quantityByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of cart.groups) {
      for (const it of g.items) {
        map.set(it.product_id, Number(it.quantity));
      }
    }
    return map;
  }, [cart.groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  function handleSearch(value: string) {
    setSearch(value);
    if (value.trim().length >= 3) {
      trackEvent("search_performed", { query: value.trim() });
    }
  }

  return (
    <Container size="lg" className="py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <Text variant="h2" as="h2">
            Market
          </Text>
          <Text variant="body" muted className="block mt-1">
            Browse listed farm products and add them to your cart.
          </Text>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label id="category-filter-label" className="text-sm font-medium">Category</label>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground"
            value={category}
            onChange={(e) => setCategory(e.target.value as ProductCategory | "All")}
            aria-labelledby="category-filter-label"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <Input
            label="Search"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by product name..."
          />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading products">
          {Array.from({ length: 9 }).map((_, i) => (
            <Card key={i} variant="outlined" padding="md" aria-hidden="true">
              <CardContent className="space-y-3">
                <div className="h-32 bg-border/30 rounded-lg" />
                <div className="h-4 bg-border/30 rounded w-3/4" />
                <div className="h-4 bg-border/30 rounded w-1/2" />
                <div className="h-10 bg-border/30 rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card variant="elevated" padding="lg" role="alert">
          <CardContent>
            <Text variant="body" className="text-error">
              {error}
            </Text>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="list" aria-label="Product listings">
          {filtered.map((p) => {
            const currentQty = quantityByProductId.get(p.id) ?? 0;
            return (
              <Card key={p.id} variant="elevated" padding="md" role="listitem">
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image_url}
                      alt={p.name}
                      className="w-full h-40 object-cover rounded-lg border border-border/60"
                    />
                  ) : (
                    <div className="w-full h-40 rounded-lg border border-border/60 bg-border/20" aria-hidden="true" />
                  )}

                  <div>
                    <Text variant="body" muted className="text-sm">
                      Price
                    </Text>
                    <Text variant="body" className="font-medium">
                      {p.price_per_unit} {p.currency} / {p.unit}
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

                  <PriceChart
                    productId={p.id}
                    productName={p.name}
                    currency={p.currency}
                    unit={p.unit}
                  />

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        disabled={!connected || currentQty <= 0}
                        onClick={() =>
                          setQuantityForProduct(p.id, currentQty - 1)
                        }
                        aria-label={`Decrease quantity of ${p.name}`}
                      >
                        -
                      </Button>
                      <Text variant="body" className="min-w-8 text-center" aria-live="polite" aria-label={`Quantity: ${currentQty}`}>
                        {currentQty}
                      </Text>
                      <Button
                        variant="outline"
                        disabled={!connected}
                        onClick={() =>
                          setQuantityForProduct(p.id, currentQty + 1)
                        }
                        aria-label={`Increase quantity of ${p.name}`}
                      >
                        +
                      </Button>
                    </div>
                    {!connected ? (
                      <Text variant="body" muted className="text-xs">
                        Connect to add
                      </Text>
                    ) : currentQty === 0 ? (
                      <Button
                        variant="primary"
                        onClick={() => {
                          setQuantityForProduct(p.id, 1);
                          trackEvent("product_added_to_cart", { productId: p.id, productName: p.name });
                        }}
                      >
                        Add
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}
