"use client";

import React, { useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WalletContext } from "@/context/WalletContext";
import { useCart } from "@/context/CartContext";
import type { CartGroup } from "@/types/cart";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Container,
  Text,
} from "@/components/ui";
import { createOrderWithOrderId, approveToken } from "@/services/stellar/contractService";
import { getNetworkConfig } from "@/services/stellar/networkConfig";
import { useWallet } from "@/hooks/useWallet";

type OrderSuccess = { orderId: string; farmerWallet: string; txHash: string };
type OrderFailure = { farmerWallet: string; error: string };

function feeFromGross(gross: bigint) {
  return (gross * BigInt(3)) / BigInt(100);
}

function currencyToTokenContract(currency: string) {
  switch (currency) {
    case "STRK":
      return process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID_STRK ?? "";
    case "USDC":
      return process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC ?? "";
    default:
      return "";
  }
}

export default function CartDrawer() {
  const router = useRouter();
  const wallet = useWallet();
  const { cart, cartLoading, cartError, drawerOpen, setDrawerOpen, itemCount, refreshCart, setQuantityForProduct, removeCartItem } =
    useCart();
  const { address, connected, signAndSubmit } = wallet;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [running, setRunning] = useState(false);

  const [successOrders, setSuccessOrders] = useState<OrderSuccess[]>([]);
  const [failedOrders, setFailedOrders] = useState<OrderFailure[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [groupProgress, setGroupProgress] = useState<Record<string, "pending" | "success" | "error">>({});

  const totalGross = useMemo(() => {
    return cart.groups.reduce(
      (acc, g) => acc + (BigInt(g.subtotal) || BigInt(0)),
      BigInt(0),
    );
  }, [cart.groups]);

  const totals = useMemo(() => {
    const gross = totalGross;
    const fee = feeFromGross(gross);
    const net = gross - fee;
    return { gross, fee, net };
  }, [totalGross]);

  const closeAndReset = () => {
    setStep(1);
    setRunning(false);
    setDeliveryDeadline("");
    setSuccessOrders([]);
    setFailedOrders([]);
    setProgressMessage("");
    setGroupProgress({});
    setDrawerOpen(false);
  };

  async function createOrdersForCart(groups: CartGroup[]) {
    if (!address || !connected) {
      alert("Connect your wallet to checkout.");
      return;
    }
    const deadline = deliveryDeadline?.trim();
    if (!deadline) {
      alert("Please select a delivery deadline.");
      return;
    }

    setRunning(true);
    setSuccessOrders([]);
    setFailedOrders([]);
    setProgressMessage("Starting checkout...");
    setGroupProgress(Object.fromEntries(groups.map((g) => [g.farmer_wallet, "pending"])));

    try {
      // Sequential processing to match wallet UX and progress reporting.
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const farmerWallet = group.farmer_wallet;
        const idxLabel = `${i + 1} of ${groups.length}`;

        const gross = BigInt(group.subtotal || "0");
        const fee = feeFromGross(gross);
        const net = gross - fee;

        setProgressMessage(`Creating order ${idxLabel}...`);

        const tokenContractId = currencyToTokenContract(group.currency);
        if (!tokenContractId) {
          const error = `Missing token contract id for currency ${group.currency}.`;
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        if (net <= BigInt(0)) {
          const error = "Net amount must be positive.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        const { contractId } = getNetworkConfig();

        // Step A: (Optional) token approval. If simulation fails, we proceed to create_order.
        if (contractId && contractId.trim().length > 0) {
          const approval = await approveToken(address, tokenContractId, contractId, net);
          if (approval.success && approval.data) {
            setProgressMessage(`Approving escrow for ${farmerWallet} (${idxLabel})...`);
            const approvalResult = await signAndSubmit(approval.data);
            if (!approvalResult.success || !approvalResult.txHash) {
              const error = approvalResult.error || "Approval transaction failed.";
              setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
              setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
              continue;
            }
          }
        }

        // Step B: create_order
        const built = await createOrderWithOrderId(
          address,
          farmerWallet,
          tokenContractId,
          net,
          deadline,
        );

        if (!built.success || !built.data) {
          const error = built.error || "Failed to build create_order transaction.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        setProgressMessage(`Creating escrow order for ${farmerWallet} (${idxLabel})...`);
        const builtData = built.data;
        const createResult = await signAndSubmit(builtData.txXdr);
        if (!createResult.success || !createResult.txHash) {
          const error = createResult.error || "create_order transaction failed.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        const txHash = createResult.txHash!;
        setSuccessOrders((prev) => [
          ...prev,
          { orderId: builtData.orderId, farmerWallet, txHash },
        ]);
        setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "success" }));

        // Remove cart items for this farmer group after successful escrow creation.
        // This enables partial checkout without duplicating successful orders.
        const itemsToRemove = group.items.map((it) => it.id);
        for (const itemId of itemsToRemove) {
          await removeCartItem(itemId);
        }
        // Refresh cart to keep badge/count consistent.
        await refreshCart();
      }
    } finally {
      setRunning(false);
      setStep(3);
      setProgressMessage("Checkout complete.");
    }
  }

  if (!drawerOpen) return null;

  const groups = cart.groups;
  const empty = groups.length === 0;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => closeAndReset()}
        role="button"
        tabIndex={0}
      />

      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-gray-950 text-white shadow-2xl flex flex-col">
        <div className="p-4 flex items-center justify-between gap-3 border-b border-white/10">
          <Text variant="h3" as="h3">
            Cart ({itemCount})
          </Text>
          <Button variant="outline" onClick={closeAndReset}>
            Close
          </Button>
        </div>

        <div className="p-4 flex-1 overflow-auto">
          {cartLoading ? (
            <Text variant="body" muted>Loading cart...</Text>
          ) : cartError ? (
            <Text variant="body" className="text-error">{cartError}</Text>
          ) : empty ? (
            <Card variant="outlined" padding="md">
              <CardContent className="py-10 text-center space-y-3">
                <Text variant="h3" as="h3">
                  Your cart is empty
                </Text>
                <Text variant="body" muted>
                  Browse the market and add products to checkout.
                </Text>
                <Button
                  variant="primary"
                  onClick={() => {
                    closeAndReset();
                    router.push("/market");
                  }}
                >
                  Browse Market
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {step === 1 && (
                <div className="space-y-5">
                  <Text variant="h4" as="h4">
                    Review Cart
                  </Text>

                  <div className="space-y-4">
                    {groups.map((g) => {
                      const gross = BigInt(g.subtotal);
                      const fee = feeFromGross(gross);
                      const net = gross - fee;
                      return (
                        <Card key={g.farmer_wallet} variant="elevated" padding="md">
                          <CardHeader>
                            <CardTitle className="text-base">
                              {g.farmer_name}
                            </CardTitle>
                            <Text variant="body" muted>
                              {g.currency}
                            </Text>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {g.items.map((it) => (
                              <div key={it.id} className="flex items-center justify-between gap-3">
                                <div>
                                  <Text variant="body" className="font-medium">
                                    {it.name}
                                  </Text>
                                  <Text variant="body" muted className="text-xs">
                                    {it.quantity} × {it.unit_price} / {it.unit}
                                  </Text>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() => setQuantityForProduct(it.product_id, Number(it.quantity) - 1)}
                                  >
                                    -
                                  </Button>
                                  <Text variant="body" className="min-w-8 text-center">
                                    {it.quantity}
                                  </Text>
                                  <Button
                                    variant="outline"
                                    onClick={() => setQuantityForProduct(it.product_id, Number(it.quantity) + 1)}
                                  >
                                    +
                                  </Button>
                                </div>
                              </div>
                            ))}

                            <div className="border-t border-white/10 pt-3 space-y-1">
                              <div className="flex justify-between text-sm">
                                <span>Gross</span>
                                <span>{gross.toString()}</span>
                              </div>
                              <div className="flex justify-between text-sm text-white/70">
                                <span>Fee (3%)</span>
                                <span>{fee.toString()}</span>
                              </div>
                              <div className="flex justify-between text-sm">
                                <span>Net</span>
                                <span>{net.toString()}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  <Card variant="elevated" padding="md">
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Total Gross</span>
                        <span>{totals.gross.toString()}</span>
                      </div>
                      <div className="flex justify-between text-sm text-white/70">
                        <span>Total Fee (3%)</span>
                        <span>{totals.fee.toString()}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Total Net</span>
                        <span>{totals.net.toString()}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setDrawerOpen(false)} disabled={running}>
                      Continue shopping
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => setStep(2)}
                      disabled={running}
                      fullWidth
                    >
                      Proceed to Checkout
                    </Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <Text variant="h4" as="h4">
                    Confirm Orders
                  </Text>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Delivery deadline
                    </label>
                    <input
                      type="datetime-local"
                      value={deliveryDeadline}
                      onChange={(e) => setDeliveryDeadline(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-foreground text-base"
                    />
                  </div>

                  <Card variant="elevated" padding="md">
                    <CardContent className="space-y-2">
                      <Text variant="body" className="font-medium">
                        Progress
                      </Text>
                      <Text variant="body" muted className="text-sm">
                        {progressMessage || "Pending..."}
                      </Text>
                      {groups.map((g) => {
                        const st = groupProgress[g.farmer_wallet] ?? "pending";
                        return (
                          <div key={g.farmer_wallet} className="flex justify-between text-sm text-white/80">
                            <span>{g.farmer_name}</span>
                            <span>
                              {st === "pending" ? "Pending" : st === "success" ? "Success" : "Failed"}
                            </span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => setStep(1)}
                      disabled={running}
                    >
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      onClick={() => void createOrdersForCart(groups)}
                      disabled={running}
                      fullWidth
                    >
                      {running ? "Creating orders..." : "Confirm & Create Escrow Orders"}
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <Text variant="h4" as="h4">
                    Order Confirmation
                  </Text>

                  {successOrders.length > 0 ? (
                    <Card variant="elevated" padding="md">
                      <CardHeader>
                        <CardTitle className="text-base">Created</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {successOrders.map((o) => (
                          <div key={`${o.farmerWallet}-${o.orderId}`} className="flex justify-between gap-3">
                            <div>
                              <Text variant="body" className="font-medium">
                                Order #{o.orderId}
                              </Text>
                              <Text variant="body" muted className="text-xs break-all">
                                {o.txHash}
                              </Text>
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => router.push(`/orders/${o.orderId}`)}
                            >
                              View
                            </Button>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}

                  {failedOrders.length > 0 ? (
                    <Card variant="outlined" padding="md">
                      <CardHeader>
                        <CardTitle className="text-base">Failed</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {failedOrders.map((f, idx) => (
                          <div key={idx} className="space-y-1">
                            <Text variant="body" className="font-medium">
                              {f.farmerWallet}
                            </Text>
                            <Text variant="body" muted className="text-sm">
                              {f.error}
                            </Text>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ) : null}

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStep(1);
                      }}
                    >
                      Back to cart
                    </Button>
                    <Button
                      variant="primary"
                      onClick={closeAndReset}
                      fullWidth
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

