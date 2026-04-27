"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@/context/WalletContext";
import { fetchCampaign, formatAmount } from "@/services/campaignService";
import { createOrder } from "@/services/orderService";
import { buildCreateOrder } from "@/lib/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import type { CampaignDetail, Order } from "@/types";

type TxStatus = "idle" | "creating" | "awaiting_signature" | "submitting" | "success" | "error";

interface StepState {
  offChain: "idle" | "loading" | "done" | "error";
  onChain: "idle" | "loading" | "done" | "error";
}

export default function CheckoutPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const { address, connected, connect, loading: walletLoading } = useWallet();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  const [amountXlm, setAmountXlm] = useState("");
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [stepState, setStepState] = useState<StepState>({ offChain: "idle", onChain: "idle" });
  const [txError, setTxError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    fetchCampaign(campaignId)
      .then(setCampaign)
      .catch((err: unknown) =>
        setCampaignError(err instanceof Error ? err.message : "Campaign not found"),
      )
      .finally(() => setCampaignLoading(false));
  }, [campaignId]);

  const amountStroops = amountXlm
    ? BigInt(Math.floor(parseFloat(amountXlm) * 1e7))
    : 0n;

  const canSubmit =
    connected &&
    campaign &&
    amountXlm &&
    parseFloat(amountXlm) > 0 &&
    txStatus === "idle";

  async function handleCheckout() {
    if (!address || !campaign || !canSubmit) return;

    setTxStatus("creating");
    setTxError(null);
    setStepState({ offChain: "loading", onChain: "idle" });

    let order: Order;
    try {
      order = await createOrder({
        buyerAddress: address,
        campaignId: campaign.id,
        amount: String(amountStroops),
      });
      setCreatedOrder(order);
      setStepState((s) => ({ ...s, offChain: "done" }));
    } catch (err) {
      setTxError(err instanceof Error ? err.message : "Failed to record order");
      setStepState((s) => ({ ...s, offChain: "error" }));
      setTxStatus("error");
      return;
    }

    // On-chain: build & sign the create_order transaction
    setTxStatus("awaiting_signature");
    setStepState((s) => ({ ...s, onChain: "loading" }));

    const builtResult = await buildCreateOrder(address, campaign.onChainId, amountStroops);
    if (!builtResult.success || !builtResult.data) {
      const msg = builtResult.error ?? "Failed to build contract transaction";
      if (msg.includes("NEXT_PUBLIC_PRODUCTION_CONTRACT_ID")) {
        // Contract not configured — off-chain order was still created successfully
        setTxHash(null);
        setStepState((s) => ({ ...s, onChain: "done" }));
        setTxStatus("success");
        return;
      }
      setTxError(msg);
      setStepState((s) => ({ ...s, onChain: "error" }));
      setTxStatus("error");
      return;
    }

    setTxStatus("submitting");
    const result = await signAndSubmitTransaction(builtResult.data);
    if (result.success) {
      setTxHash(result.txHash ?? null);
      setStepState((s) => ({ ...s, onChain: "done" }));
      setTxStatus("success");
    } else {
      setTxError(result.error ?? "Transaction failed");
      setStepState((s) => ({ ...s, onChain: "error" }));
      setTxStatus("error");
    }
  }

  if (campaignLoading) {
    return <div className="animate-pulse h-64 bg-neutral-200 rounded-xl" />;
  }

  if (campaignError || !campaign) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-red-700 text-sm">
        {campaignError ?? "Campaign not found."}
      </div>
    );
  }

  const canOrder = campaign.status === "HARVESTED" || campaign.status === "IN_PRODUCTION";

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href={`/campaigns/${campaign.id}`} className="text-sm text-muted hover:text-foreground">
        ← Back to Campaign
      </Link>

      <h1 className="text-2xl font-bold text-foreground">Place Order</h1>

      {/* Campaign summary */}
      <div className="border border-border rounded-xl p-5 bg-surface space-y-2 text-sm">
        <p className="font-semibold text-foreground mb-3">Campaign Summary</p>
        <div className="flex justify-between">
          <span className="text-muted">Status</span>
          <span className="font-medium text-foreground">{campaign.status.replace("_", " ")}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Farmer</span>
          <span className="font-mono text-xs text-foreground">
            {campaign.farmerAddress.slice(0, 8)}…{campaign.farmerAddress.slice(-6)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Goal</span>
          <span className="font-medium text-foreground">
            {formatAmount(campaign.targetAmount)} XLM
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Raised</span>
          <span className="font-medium text-foreground">
            {formatAmount(campaign.totalRaised)} XLM
          </span>
        </div>
      </div>

      {!canOrder && (
        <div className="border border-yellow-200 bg-yellow-50 rounded-xl p-4 text-yellow-800 text-sm">
          This campaign is not currently accepting orders (status: {campaign.status}).
        </div>
      )}

      {canOrder && (
        <>
          {/* Wallet */}
          {!connected ? (
            <div className="border border-border rounded-xl p-5 text-center space-y-3">
              <p className="text-sm text-muted">Connect your wallet to place an order.</p>
              <button
                onClick={connect}
                disabled={walletLoading}
                className="bg-primary-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {walletLoading ? "Connecting…" : "Connect Wallet"}
              </button>
            </div>
          ) : (
            <div className="text-xs text-muted">
              Ordering as:{" "}
              <span className="font-mono text-foreground">{address}</span>
            </div>
          )}

          {/* Amount input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1" htmlFor="amount">
              Order Amount (XLM)
            </label>
            <input
              id="amount"
              type="number"
              min="0.0000001"
              step="0.0000001"
              value={amountXlm}
              onChange={(e) => setAmountXlm(e.target.value)}
              placeholder="e.g. 100"
              disabled={txStatus !== "idle"}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
            />
            {amountXlm && parseFloat(amountXlm) > 0 && (
              <p className="text-xs text-muted mt-1">
                = {amountStroops.toLocaleString()} stroops
              </p>
            )}
          </div>

          {/* Transaction steps */}
          {txStatus !== "idle" && (
            <div className="border border-border rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-foreground">Transaction Progress</p>

              <Step
                label="Record order (off-chain)"
                state={stepState.offChain}
              />
              <Step
                label="Submit to Stellar (on-chain)"
                state={stepState.onChain}
                extra={txHash ? (
                  <span className="font-mono text-xs break-all text-muted">
                    {txHash.slice(0, 16)}…{txHash.slice(-8)}
                  </span>
                ) : undefined}
              />
            </div>
          )}

          {txStatus === "success" && (
            <div className="border border-primary-200 bg-primary-50 rounded-xl p-5 space-y-2">
              <p className="font-semibold text-primary-800">✓ Order Created Successfully</p>
              {createdOrder && (
                <p className="text-sm text-primary-700">Order ID: {createdOrder.id}</p>
              )}
              {txHash && (
                <p className="text-xs text-primary-700">
                  On-chain TX: <span className="font-mono">{txHash}</span>
                </p>
              )}
              <Link
                href="/orders"
                className="inline-block mt-2 text-sm text-primary-600 underline hover:text-primary-800"
              >
                View in Order Dashboard →
              </Link>
            </div>
          )}

          {txStatus === "error" && txError && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-4 text-red-700 text-sm">
              <p className="font-semibold mb-1">Error</p>
              <p>{txError}</p>
              <button
                onClick={() => { setTxStatus("idle"); setTxError(null); setStepState({ offChain: "idle", onChain: "idle" }); }}
                className="mt-2 text-xs underline text-red-600 hover:text-red-800"
              >
                Try again
              </button>
            </div>
          )}

          {/* Submit button */}
          {(txStatus === "idle" || txStatus === "error") && txStatus !== "success" && (
            <button
              onClick={handleCheckout}
              disabled={!canSubmit}
              className="w-full bg-primary-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Place Escrow Order
            </button>
          )}

          {(txStatus === "creating" || txStatus === "awaiting_signature" || txStatus === "submitting") && (
            <div className="w-full bg-primary-100 text-primary-700 py-3 rounded-xl font-semibold text-sm text-center">
              {txStatus === "creating" && "Recording order…"}
              {txStatus === "awaiting_signature" && "Waiting for wallet signature…"}
              {txStatus === "submitting" && "Submitting to Stellar…"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Step({
  label,
  state,
  extra,
}: {
  label: string;
  state: "idle" | "loading" | "done" | "error";
  extra?: React.ReactNode;
}) {
  const icon =
    state === "done"
      ? "✓"
      : state === "error"
      ? "✗"
      : state === "loading"
      ? "⟳"
      : "○";

  const color =
    state === "done"
      ? "text-primary-600"
      : state === "error"
      ? "text-error"
      : state === "loading"
      ? "text-yellow-600 animate-spin inline-block"
      : "text-muted";

  return (
    <div className="flex items-start gap-3 text-sm">
      <span className={`font-bold mt-0.5 ${color}`}>{icon}</span>
      <div>
        <span className={state === "idle" ? "text-muted" : "text-foreground"}>{label}</span>
        {extra && <div className="mt-0.5">{extra}</div>}
      </div>
    </div>
  );
}
