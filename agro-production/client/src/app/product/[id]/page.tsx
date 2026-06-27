"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchProduct, formatPrice } from "@/services/productService";
import { useTransaction } from "@/hooks/useTransaction";
import { buildCreateOrder } from "@/lib/contractService";
import { createOrder } from "@/services/orderService";
import { useWallet } from "@/context/WalletContext";
import WalletConnect from "@/components/WalletConnect";
import { validateQuantity, sanitizeString } from "@/lib/validation";
import { trackProductViewed } from "@/lib/analytics";
import { classifyError, logErrorWithContext } from "@/lib/errorHandling";
import { isNetworkError } from "@/lib/apiClient";
import { ButtonSpinner } from "@/components/Skeletons";
import type { Product, Order } from "@/types";

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const { address, connected } = useWallet();
  const tx = useTransaction();

  useEffect(() => {
    if (!id) return;
    fetchProduct(id)
      .then((p) => {
        setProduct(p);
        trackProductViewed(id);
      })
      .catch((err: unknown) => setError(isNetworkError(err) ? "Network error — check your connection and try again" : err instanceof Error ? err.message : "Failed to load product"))
      .finally(() => setLoading(false));
  }, [id]);

  function handleQuantityChange(value: string) {
    const result = validateQuantity(value, 1, product?.quantity ?? 999999);
    if (result.valid) {
      setQuantity(Number(result.sanitized));
      setQuantityError(null);
    } else {
      setQuantity(Number(value) || 0);
      setQuantityError(result.error);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-neutral-200 rounded" />
        <div className="h-64 bg-neutral-200 rounded-xl" />
        <div className="h-24 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (error) return (<div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm" role="alert">{error}</div>);
  if (!product) return null;

  const unitPrice = BigInt(product.pricePerUnit || "0");
  const totalPrice = unitPrice * BigInt(quantity);

  /**
   * Order lifecycle: draft → submitted → confirmed | failed
   * 1. Create off-chain order record via createOrder
   * 2. Build unsigned transaction via buildCreateOrder
   * 3. Sign and submit via signAndSubmitTransaction (handled by useTransaction)
   * 4. On success, order status moves to confirmed
   */
  async function handleOrder() {
    if (!address || !product) return;

    const campaignId = product.campaignId ?? "0";

    // Quantity validation already occurred via quantityError state
    if (quantityError) return;

    // Pass a builder function to tx.execute that will:
    // 1. Create off-chain order record
    // 2. Build the transaction XDR
    await tx.execute(async () => {
      try {
        // Step 1: Create off-chain order record
        const order = await createOrder({
          buyerAddress: address,
          campaignId: sanitizeString(campaignId),
          amount: String(totalPrice),
        });
        setCreatedOrder(order);

        // Step 2: Build transaction with the same amount (no floating-point issues with BigInt)
        const builtResult = await buildCreateOrder(address, campaignId, totalPrice);
        if (!builtResult.success || !builtResult.data) {
          const classified = classifyError(builtResult.error, "buildOrderTransaction");
          throw new Error(builtResult.error ?? classified.actionableMessage);
        }

        return builtResult.data;
      } catch (err) {
        const classified = classifyError(err, "productCheckout");
        logErrorWithContext(err, {
          feature: "productCheckout",
          action: "checkout",
          productId: id,
          campaignId,
          quantity,
          address,
          category: classified.category,
        });
        throw err;
      }
    });
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
        <Link href="/marketplace" className="hover:text-foreground">Marketplace</Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground" aria-current="page">{product.name}</span>
      </nav>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="h-64 md:h-auto bg-neutral-100 rounded-xl flex items-center justify-center text-6xl" role="img" aria-label={product.imageUrl ? `Image of ${product.name}` : `Placeholder for ${product.name}`}>
          {product.imageUrl ? (<img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover rounded-xl" />) : (<span aria-hidden="true">🌱</span>)}
        </div>
        <div className="space-y-5">
          <div>
            <span className="text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">{product.category}</span>
            <h1 className="text-2xl font-bold text-foreground mt-2">{product.name}</h1>
            <p className="text-sm text-muted mt-1">{product.description}</p>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-semibold text-foreground">{formatPrice(product.pricePerUnit)} XLM<span className="text-sm font-normal text-muted"> / {product.unit}</span></p>
            <p className="text-sm text-muted">{product.quantity} {product.unit}(s) available · {product.location}</p>
            <p className="text-xs font-mono text-muted">Farmer: {product.farmerAddress.slice(0, 6)}…{product.farmerAddress.slice(-4)}</p>
          </div>
          {connected && address ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="product-quantity" className="block text-sm font-medium text-foreground mb-1">Quantity ({product.unit})</label>
                <input
                  id="product-quantity"
                  type="number"
                  min={1}
                  max={product.quantity}
                  value={quantity}
                  onChange={(e) => handleQuantityChange(e.target.value)}
                  aria-invalid={!!quantityError}
                  aria-describedby={quantityError ? "quantity-error" : undefined}
                  className="w-24 border border-border rounded-lg px-3 py-1.5 text-sm bg-background text-foreground"
                />
                {quantityError && (
                  <p id="quantity-error" className="text-xs text-error mt-1" role="alert">{quantityError}</p>
                )}
              </div>
              <p className="text-sm text-muted">Total: <span className="font-semibold text-foreground">{formatPrice(String(totalPrice))} XLM</span></p>
              {tx.isSuccess && (<div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800" role="status"><p className="font-semibold mb-1">✓ Order Created Successfully</p>{createdOrder && <p>Order ID: {createdOrder.id}</p>}{tx.txHash && (<p className="text-xs mt-1 font-mono">Tx: {tx.txHash}</p>)}</div>)}
              {tx.isError && (<div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700" role="alert"><p className="font-semibold mb-1">Error</p><p>{tx.error}</p></div>)}
              <button
                onClick={() => void handleOrder()}
                disabled={tx.isPending || tx.isSuccess || !!quantityError}
                aria-label={`Place order for ${quantity} ${product.unit}(s) of ${product.name}`}
                className="w-full bg-primary-600 text-white py-2.5 rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 transition-colors text-sm inline-flex items-center justify-center gap-2"
              >
                {tx.isPending && <ButtonSpinner />}
                {tx.isPending ? "Processing…" : tx.isSuccess ? "Order Placed" : "Place Order"}
              </button>
              {tx.isError && (<button onClick={tx.reset} className="w-full text-sm text-muted hover:text-foreground">Try again</button>)}
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

