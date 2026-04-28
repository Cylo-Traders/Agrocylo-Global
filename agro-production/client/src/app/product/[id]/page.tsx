"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchProduct, formatPrice } from "@/services/productService";
import { useTransaction } from "@/hooks/useTransaction";
import { buildCreateOrder } from "@/lib/contractService";
import { useWallet } from "@/context/WalletContext";
import WalletConnect from "@/components/WalletConnect";
import type { Product } from "@/types";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const { address, connected } = useWallet();
  const tx = useTransaction();

  useEffect(() => {
    if (!id) return;
    fetchProduct(id)
      .then(setProduct)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load product")
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200 rounded" />
        <div className="h-64 bg-neutral-200 rounded-xl" />
        <div className="h-24 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm">
        {error}
      </div>
    );
  }

  if (!product) return null;

  const unitPrice = BigInt(product.pricePerUnit || "0");
  const totalPrice = unitPrice * BigInt(quantity);

  async function handleOrder() {
    if (!address || !product) return;
    const campaignId = product.campaignId ?? "0";
    await tx.execute(() => buildCreateOrder(address!, campaignId, totalPrice));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/marketplace" className="hover:text-foreground">
          Marketplace
        </Link>
        <span>/</span>
        <span className="text-foreground">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="h-64 md:h-auto bg-neutral-100 rounded-xl flex items-center justify-center text-6xl">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover rounded-xl"
            />
          ) : (
            <span>🌱</span>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
              {product.category}
            </span>
            <h1 className="text-2xl font-bold text-foreground mt-2">{product.name}</h1>
            <p className="text-sm text-muted mt-1">{product.description}</p>
          </div>

          <div className="space-y-1">
            <p className="text-2xl font-semibold text-foreground">
              {formatPrice(product.pricePerUnit)} XLM
              <span className="text-sm font-normal text-muted"> / {product.unit}</span>
            </p>
            <p className="text-sm text-muted">
              {product.quantity} {product.unit}(s) available · {product.location}
            </p>
            <p className="text-xs font-mono text-muted">
              Farmer: {product.farmerAddress.slice(0, 6)}…{product.farmerAddress.slice(-4)}
            </p>
          </div>

          {connected && address ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Quantity ({product.unit})
                </label>
                <input
                  type="number"
                  min={1}
                  max={product.quantity}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Math.min(product.quantity, Number(e.target.value))))
                  }
                  className="w-24 border border-border rounded-lg px-3 py-1.5 text-sm bg-background text-foreground"
                />
              </div>
              <p className="text-sm text-muted">
                Total:{" "}
                <span className="font-semibold text-foreground">
                  {formatPrice(String(totalPrice))} XLM
                </span>
              </p>

              {tx.isSuccess && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                  Order placed!{" "}
                  {tx.txHash && (
                    <span className="font-mono text-xs">
                      Tx: {tx.txHash.slice(0, 12)}…
                    </span>
                  )}
                </div>
              )}
              {tx.isError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {tx.error}
                </div>
              )}

              <button
                onClick={() => void handleOrder()}
                disabled={tx.isPending || tx.isSuccess}
                className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors text-sm"
              >
                {tx.isPending ? "Processing…" : tx.isSuccess ? "Order Placed" : "Place Order"}
              </button>
              {tx.isError && (
                <button
                  onClick={tx.reset}
                  className="w-full text-sm text-muted hover:text-foreground"
                >
                  Try again
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted">Connect your wallet to place an order.</p>
              <WalletConnect />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
