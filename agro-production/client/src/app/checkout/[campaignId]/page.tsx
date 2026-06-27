"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { fetchCampaign, formatAmount } from "@/services/campaignService";
import { createOrder, updateOrderWithTxHash } from "@/services/orderService";
import { buildCreateOrder } from "@/lib/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import { parseXlmToStroops, validateStellarAddress, sanitizeString } from "@/lib/validation";
import { trackOrderPlaced } from "@/lib/analytics";
import { classifyError, logErrorWithContext } from "@/lib/errorHandling";
import { ButtonSpinner } from "@/components/Skeletons";
import TransactionProgress from "@/components/TransactionProgress";
import { idleMachine, advanceMachine } from "@/types/transaction";
import type { TxMachineState } from "@/types/transaction";
import type { CampaignDetail, Order } from "@/types";

export default function CheckoutPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { address, connected, connect, loading: walletLoading } = useWallet();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [amountXlm, setAmountXlm] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxMachineState>(idleMachine());
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    fetchCampaign(campaignId)
      .then(setCampaign)
      .catch((err: unknown) => {
        const classified = classifyError(err, "loadCampaign");
        logErrorWithContext(err, {
          feature: "checkout",
          action: "loadCampaign",
          campaignId,
          category: classified.category,
        });
        setCampaignError(classified.actionableMessage);
      })
      .finally(() => setCampaignLoading(false));
  }, [campaignId]);

  const amountResult = parseXlmToStroops(amountXlm);
  const amountStroops = amountResult.valid ? amountResult.stroops : 0n;
  const isIdle = tx.phase === "idle" || tx.phase === "failed";
  const isInFlight = tx.phase === "recording" || tx.phase === "signing" || tx.phase === "submitting" || tx.phase === "confirming";
  const canSubmit = Boolean(connected && campaign && amountResult.valid && isIdle && !amountError);

  function handleAmountChange(value: string) {
    setAmountXlm(value);
    if (value) {
      const result = parseXlmToStroops(value);
      setAmountError(result.valid ? null : result.error);
    } else {
      setAmountError(null);
    }
  }

  async function handleCheckout() {
    if (!address || !campaign || !canSubmit) return;

    const addrResult = validateStellarAddress(address);
    if (!addrResult.valid) {
      setTx(advanceMachine(idleMachine(), "recording"));
      setTx(advanceMachine(advanceMachine(idleMachine(), "recording"), "failed", { error: addrResult.error }));
      return;
    }

    // Step 1 — build on-chain transaction
    let current = advanceMachine(idleMachine(), "recording");
    setTx(current);

    const builtResult = await buildCreateOrder(addrResult.sanitized, campaign.onChainId, amountStroops);
    if (!builtResult.success || !builtResult.data) {
      const classified = classifyError(builtResult.error, "buildOrderTransaction");
      logErrorWithContext(builtResult.error ?? "build transaction failed", {
        feature: "checkout",
        action: "buildOrderTransaction",
        campaignId: campaign.id,
        onChainId: campaign.onChainId,
        buyerAddress: addrResult.sanitized,
        amountStroops: String(amountStroops),
        category: classified.category,
      });
      setTx(advanceMachine(current, "failed", { error: classified.actionableMessage }));
      return;
    }

    // Step 2 — sign
    current = advanceMachine(current, "signing");
    setTx(current);

    const result = await signAndSubmitTransaction(builtResult.data);
    if (!result.success) {
      const classified = classifyError(result.error, "submitOrderTransaction");
      logErrorWithContext(result.error ?? "transaction failed", {
        feature: "checkout",
        action: "submitOrderTransaction",
        campaignId: campaign.id,
        buyerAddress: addrResult.sanitized,
        amountStroops: String(amountStroops),
        txHash: result.txHash,
        status: result.status,
        category: classified.category,
      });
      setTx(advanceMachine(current, "failed", { error: classified.actionableMessage }));
      return;
    }

    // Step 3 — submit
    current = advanceMachine(current, "submitting");
    setTx(current);

    // Step 4 — confirm (immediate for Stellar test network)
    current = advanceMachine(current, "confirming");
    setTx(current);

    // Step 5 — record off-chain after confirmation
    let order: Order;
    try {
      order = await createOrder({
        buyerAddress: addrResult.sanitized,
        campaignId: sanitizeString(campaign.id),
        amount: String(amountStroops),
      });
      setCreatedOrder(order);

      // Update order with transaction hash
      if (result.txHash) {
        try {
          await updateOrderWithTxHash(order.id, result.txHash);
        } catch (err) {
          logErrorWithContext(err, {
            feature: "checkout",
            action: "updateOrderTxHash",
            orderId: order.id,
            txHash: result.txHash,
          });
        }
      }
    } catch (err) {
      const classified = classifyError(err, "recordOrder");
      logErrorWithContext(err, {
        feature: "checkout",
        action: "recordOrder",
        campaignId: campaign.id,
        buyerAddress: addrResult.sanitized,
        amountStroops: String(amountStroops),
        txHash: result.txHash,
        category: classified.category,
      });
      setTx(advanceMachine(current, "failed", { error: classified.actionableMessage }));
      return;
    }

    current = advanceMachine(current, "success", { txHash: result.txHash });
    setTx(current);
    trackOrderPlaced(campaign.id, String(amountStroops));
  }

  if (campaignLoading) return <div className="animate-pulse h-64 bg-neutral-200 rounded-xl" aria-label="Loading checkout" />;
  if (campaignError || !campaign) return (<div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm" role="alert">{campaignError ?? "Could not load this campaign. Refresh and try again."}</div>);

  const canOrder = campaign.status === "HARVESTED" || campaign.status === "IN_PRODUCTION";

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <nav aria-label="Breadcrumb">
        <Link href={`/campaigns/${campaign.id}`} className="text-sm text-muted hover:text-foreground">← Back to Campaign</Link>
      </nav>

      <h1 className="text-2xl font-bold text-foreground">Place Order</h1>

      <section aria-label="Campaign summary" className="border border-border rounded-xl p-5 bg-surface space-y-2 text-sm">
        <p className="font-semibold text-foreground mb-3">Campaign Summary</p>
        <div className="flex justify-between"><span className="text-muted">Status</span><span className="font-medium text-foreground">{campaign.status.replace("_", " ")}</span></div>
        <div className="flex justify-between"><span className="text-muted">Farmer</span><span className="font-mono text-xs text-foreground">{campaign.farmerAddress.slice(0, 8)}…{campaign.farmerAddress.slice(-6)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Goal</span><span className="font-medium text-foreground">{formatAmount(campaign.targetAmount)} XLM</span></div>
        <div className="flex justify-between"><span className="text-muted">Raised</span><span className="font-medium text-foreground">{formatAmount(campaign.totalRaised)} XLM</span></div>
      </section>

      {!canOrder && (
        <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-4 text-yellow-800 text-sm" role="alert">
          This campaign is not currently accepting orders (status: {campaign.status}).
        </div>
      )}

      {canOrder && (
        <>
          {!connected ? (
            <div className="border border-border rounded-xl p-5 text-center space-y-3">
              <p className="text-sm text-muted">Connect your wallet to place an order.</p>
              <button
                onClick={connect}
                disabled={walletLoading}
                aria-label={walletLoading ? "Connecting wallet" : "Connect wallet to place order"}
                className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {walletLoading && <ButtonSpinner />}
                {walletLoading ? "Connecting…" : "Connect Wallet"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-muted">Ordering as: <span className="font-mono text-foreground">{address}</span></div>
          )}

          {/* Amount input — disabled during transaction */}
          <div>
            <label htmlFor="order-amount" className="block text-sm font-medium text-foreground mb-1">
              Order Amount (XLM)
            </label>
            <input
              id="order-amount"
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={amountXlm}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="e.g. 100"
              disabled={isInFlight || tx.phase === "success"}
              aria-invalid={!!amountError}
              aria-describedby={amountError ? "order-amount-error" : undefined}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            />
            {amountError && (
              <p id="order-amount-error" className="text-xs text-error mt-1" role="alert">{amountError}</p>
            )}
            {amountResult.valid && !amountError && (
              <p className="text-xs text-muted mt-1">= {amountStroops.toLocaleString()} stroops</p>
            )}
          </div>

          {/* 4-step transaction progress — shown once any step begins */}
          {tx.phase !== "idle" && (
            <TransactionProgress steps={tx.steps} txHash={tx.txHash} />
          )}

          {/* Success banner */}
          {tx.phase === "success" && (
            <div className="border border-primary-200 bg-primary-50 rounded-xl p-5 space-y-2" role="status">
              <p className="font-semibold text-primary-800">✓ Order Created Successfully</p>
              {createdOrder && <p className="text-sm text-primary-700">Order ID: {createdOrder.id}</p>}
              {tx.txHash && (
                <p className="text-xs text-primary-700">On-chain TX: <span className="font-mono">{tx.txHash}</span></p>
              )}
              <Link href="/orders" className="inline-block mt-2 text-sm text-primary-600 underline hover:text-primary-800">
                View in Order Dashboard →
              </Link>
            </div>
          )}

          {/* Error banner */}
          {tx.phase === "failed" && tx.error && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-red-700 text-sm" role="alert">
              <p className="font-semibold mb-1">Error</p>
              <p>{tx.error}</p>
              <button
                onClick={() => setTx(idleMachine())}
                className="mt-2 text-xs underline text-red-600 hover:text-red-800"
              >
                Try again
              </button>
            </div>
          )}

          {/* Submit button — visible only when idle or failed */}
          {isIdle && tx.phase !== "success" && (
            <button
              onClick={() => void handleCheckout()}
              disabled={!canSubmit}
              aria-label={amountError ? `Cannot place order: ${amountError}` : "Place escrow order"}
              className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Place Escrow Order
            </button>
          )}

          {/* In-flight status label */}
          {isInFlight && (
            <div className="w-full bg-primary-100 text-primary-700 py-3 rounded-xl font-semibold text-sm text-center inline-flex items-center justify-center gap-2">
              <ButtonSpinner className="text-primary-600" />
              {tx.phase === "recording" && "Recording order…"}
              {tx.phase === "signing" && "Waiting for wallet signature…"}
              {tx.phase === "submitting" && "Submitting to Stellar…"}
              {tx.phase === "confirming" && "Confirming on ledger…"}
            </div>
          )}
        </>
      )}
    </div>
  );
}
