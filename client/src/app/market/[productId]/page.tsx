"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { WalletContext } from "@/context/WalletContext";
import { getProductById } from "@/services/productService";
import { useCart } from "@/context/CartContext";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Text,
} from "@/components/ui";
import type { Product } from "@/types/product";

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const router = useRouter();
  const { connected } = useContext(WalletContext);
  const { cart, setQuantityForProduct } = useCart();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getProductById(productId);
        if (cancelled) return;
        if (!result) {
          setError("Product not found.");
        } else {
          setProduct(result);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load product."
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const currentQty = useMemo(() => {
    if (!product) return 0;
    for (const g of cart.groups) {
      for (const it of g.items) {
        if (it.product_id === product.id) return Number(it.quantity);
      }
    }
    return 0;
  }, [cart.groups, product]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Container size="lg" className="py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="h-64 bg-border/30 rounded-lg" />
          </div>
          <Card variant="outlined" padding="md">
            <CardContent className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-4 bg-border/30 rounded w-3/4" />
              ))}
              <div className="h-10 bg-border/30 rounded" />
            </CardContent>
          </Card>
        </div>
      </Container>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────

  if (error || !product) {
    return (
      <Container size="lg" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="space-y-4">
            <Text variant="body" className="text-error">
              {error ?? "Product not found."}
            </Text>
            <Button variant="outline" onClick={() => router.push("/market")}>
              ← Back to market
            </Button>
          </CardContent>
        </Card>
      </Container>
    );
  }

  // ── Product detail ─────────────────────────────────────────────────────────

  return (
    <Container size="lg" className="py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => router.push("/market")}
        >
          Market
        </button>
        <span className="text-muted-foreground">/</span>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => router.push(`/market?category=${product.category}`)}
        >
          {product.category}
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-foreground">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* ── Left: image ── */}
        <div>
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-72 object-cover rounded-lg border border-border/60"
            />
          ) : (
            <div className="w-full h-72 rounded-lg border border-border/60 bg-border/20" />
          )}
        </div>

        {/* ── Right: details + buy ── */}
        <div className="space-y-6">
          {/* Title + meta */}
          <Card variant="elevated" padding="md">
            <CardHeader>
              <CardTitle>{product.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Price */}
              <div>
                <Text variant="body" muted className="text-sm">
                  Price
                </Text>
                <Text variant="body" className="font-medium">
                  {product.price_per_unit} {product.currency} / {product.unit}
                </Text>
              </div>

              {/* Stock */}
              <div>
                <Text variant="body" muted className="text-sm">
                  Stock
                </Text>
                <Text variant="body" className="font-medium">
                  {product.stock_quantity
                    ? product.stock_quantity
                    : "Unlimited"}
                </Text>
              </div>

              {/* Category */}
              <div>
                <Text variant="body" muted className="text-sm">
                  Category
                </Text>
                <Text variant="body" className="font-medium">
                  {product.category}
                </Text>
              </div>

              {/* Description — only if the Product type exposes it */}
              {(product as Product & { description?: string }).description && (
                <div>
                  <Text variant="body" muted className="text-sm">
                    Description
                  </Text>
                  <Text variant="body" className="mt-1">
                    {
                      (product as Product & { description?: string })
                        .description
                    }
                  </Text>
                </div>
              )}

              {/* Seller wallet — only if exposed */}
              {(product as Product & { seller_address?: string })
                .seller_address && (
                <div>
                  <Text variant="body" muted className="text-sm">
                    Seller
                  </Text>
                  <Text
                    variant="body"
                    className="font-medium font-mono text-sm break-all"
                  >
                    {
                      (product as Product & { seller_address?: string })
                        .seller_address
                    }
                  </Text>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Buy controls */}
          <Card variant="elevated" padding="md">
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!connected || currentQty <= 0}
                    onClick={() =>
                      setQuantityForProduct(product.id, currentQty - 1)
                    }
                  >
                    -
                  </Button>
                  <Text variant="body" className="min-w-8 text-center">
                    {currentQty}
                  </Text>
                  <Button
                    variant="outline"
                    disabled={!connected}
                    onClick={() =>
                      setQuantityForProduct(product.id, currentQty + 1)
                    }
                  >
                    +
                  </Button>
                </div>

                {!connected ? (
                  <Text variant="body" muted className="text-xs">
                    Connect wallet to order
                  </Text>
                ) : currentQty === 0 ? (
                  <Button
                    variant="primary"
                    onClick={() => setQuantityForProduct(product.id, 1)}
                  >
                    Add to cart
                  </Button>
                ) : null}
              </div>

              {currentQty > 0 && (
                <Text variant="body" muted className="text-xs">
                  {currentQty} {product.unit} in cart —{" "}
                  {(product.price_per_unit * currentQty).toFixed(2)}{" "}
                  {product.currency} total. Funds are held in escrow until you
                  confirm receipt.
                </Text>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Container>
  );
}
