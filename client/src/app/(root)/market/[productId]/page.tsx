 "use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Truck, Wallet } from "lucide-react";

import Wrapper from "@/components/shared/wrapper";
import { useWallet } from "@/hooks/useWallet";
import { useProduct } from "@/hooks/queries/useProducts";
import { useCart } from "@/context/CartContext";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Product } from "@/types/product";
import { useAnalytics } from "@/hooks/useAnalytics";

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const router = useRouter();
  const { connected } = useWallet();
  const { cart, setQuantityForProduct } = useCart();
  const { trackFunnelStep, trackFeatureAdoption } = useAnalytics();

  const { data: product, isLoading, error } = useProduct(productId);

  const currentQty = useMemo(() => {
    if (!product) return 0;
    for (const g of cart.groups) {
      for (const it of g.items) {
        if (it.product_id === product.id) return Number(it.quantity);
      }
    }
    return 0;
  }, [cart.groups, product]);

  useEffect(() => {
    if (product) {
      trackFunnelStep("product_discovery", "product_viewed", {
        productId: product.id,
        category: product.category,
      });
    }
  }, [product, trackFunnelStep]);

  if (isLoading) {
    return (
      <Wrapper className="py-32 md:py-40">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
          <Skeleton className="h-96 rounded-2xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-12 rounded-xl" />
          </div>
        </div>
      </Wrapper>
    );
  }

  if (error || !product) {
    return (
      <Wrapper className="py-40 text-center">
        <h1 className="text-2xl font-semibold">Product not found</h1>
        <p className="text-muted-foreground mt-2">
          {error instanceof Error
            ? error.message
            : "We couldn't find this product."}
        </p>
        <Link
          href="/market"
          className={buttonVariants({ variant: "outline", className: "mt-6" })}
        >
          <ArrowLeft className="size-4" />
          Back to market
        </Link>
      </Wrapper>
    );
  }

  // Description / seller fields are optional on the canonical Product type;
  // narrow with a cast so the JSX stays clean.
  const productExt = product as Product & {
    description?: string;
    seller_address?: string;
  };

  return (
    <Wrapper className="pt-32 pb-20 md:pt-40">
      <nav className="text-muted-foreground mb-8 flex items-center gap-2 text-sm">
        <button
          onClick={() => router.push("/market")}
          className="inline-flex min-h-11 items-center rounded-full px-3 py-2 hover:text-foreground"
        >
          Market
        </button>
        <span>/</span>
        <button
          onClick={() => router.push(`/market?category=${product.category}`)}
          className="inline-flex min-h-11 items-center rounded-full px-3 py-2 hover:text-foreground"
        >
          {product.category}
        </button>
        <span>/</span>
        <span className="text-foreground">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="bg-secondary relative aspect-square overflow-hidden rounded-2xl">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <div className="grid size-full place-content-center text-7xl">
              🌱
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <Badge variant="secondary" className="mb-3">
              {product.category}
            </Badge>
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
              {product.name}
            </h1>
            <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-sm">
              <MapPin className="size-3.5" />
              {product.location}
            </p>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs">Price</p>
              <p className="text-2xl font-bold">
                {product.price_per_unit}{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  {product.currency} / {product.unit}
                </span>
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Stock</p>
              <p className="text-2xl font-bold">
                {product.stock_quantity ?? "—"}
                {product.stock_quantity && (
                  <span className="text-muted-foreground text-sm font-normal">
                    {" "}
                    {product.unit}
                  </span>
                )}
              </p>
            </div>
          </div>

          {productExt.description && (
            <div>
              <p className="text-muted-foreground text-xs">Description</p>
              <p className="mt-1 text-sm leading-relaxed">
                {productExt.description}
              </p>
            </div>
          )}

          <div>
            <p className="text-muted-foreground text-xs">Delivery window</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm">
              <Truck className="size-3.5" />
              {product.delivery_window}
            </p>
          </div>

          <Separator />

          {connected ? (
            currentQty > 0 ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="bg-secondary flex items-center gap-2 rounded-full p-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 rounded-full"
                      onClick={() => {
                        trackFunnelStep("purchase", "quantity_decremented", {
                          productId: product.id,
                        });
                        setQuantityForProduct(product.id, currentQty - 1);
                      }}
                    >
                      −
                    </Button>
                    <span className="min-w-8 text-center font-medium">
                      {currentQty}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-11 rounded-full"
                      onClick={() => {
                        trackFunnelStep("purchase", "quantity_incremented", {
                          productId: product.id,
                        });
                        setQuantityForProduct(product.id, currentQty + 1);
                      }}
                    >
                      +
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-sm">In your cart</p>
                </div>
                <p className="text-right text-lg font-semibold">
                  Total: {(
                    Number(product.price_per_unit) * currentQty
                  ).toFixed(2)}{" "}
                  {product.currency}
                </p>
              </div>
            ) : (
              <Button
                size="lg"
                onClick={() => {
                  trackFeatureAdoption("product_detail_add_to_cart", {
                    productId: product.id,
                  });
                  trackFunnelStep("purchase", "add_to_cart", {
                    productId: product.id,
                  });
                  setQuantityForProduct(product.id, 1);
                }}
                className="w-full"
              >
                Add to cart
              </Button>
            )
          ) : (
            <div className="bg-secondary/50 flex flex-col items-start gap-3 rounded-2xl border p-4 text-sm">
              <p className="flex items-center gap-2 font-medium">
                <Wallet className="size-4" />
                Connect your Freighter wallet to buy
              </p>
              <p className="text-muted-foreground text-xs">
                Funds are held in a Soroban escrow contract until you confirm
                receipt. You stay in custody throughout.
              </p>
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
