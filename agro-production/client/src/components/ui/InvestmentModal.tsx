import { useState, useEffect, useCallback, useRef } from "react";
import { useInvest } from "@/hooks/useInvest";
import { useNetworkFee } from "@/hooks/useNetworkFee";
import { useWalletNetworkGuard } from "@/hooks/useWalletNetworkGuard";
import { parseXlmToStroops } from "@/lib/validation";
import { ButtonSpinner } from "@/components/Skeletons";

interface InvestmentModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  onChainCampaignId: string;
  investorAddress: string;
  onIndexed: () => void;
}

export default function InvestmentModal({
  open,
  onClose,
  campaignId,
  onChainCampaignId,
  investorAddress,
  onIndexed,
}: InvestmentModalProps) {
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const { invest, retryIndexing, loading, error, success, phase, txHash } = useInvest();
  const { estimate: feeEstimate, displayXlm: feeDisplay } = useNetworkFee();
  // Defense in depth (#1087): the shell banner already blocks the entry point,
  // and the signing layer refuses a mismatched wallet — this keeps the modal's
  // own submit button from ever starting a wrong-network investment.
  const networkGuard = useWalletNetworkGuard();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const amountResult = parseXlmToStroops(amount);
  const awaitingIndex = phase === "awaiting_index";

  function handleAmountChange(raw: string) {
    setAmount(raw);
    if (!raw) {
      setAmountError(null);
      return;
    }
    const result = parseXlmToStroops(raw);
    setAmountError(result.valid ? null : result.error);
  }

  const isFormValid = amountResult.valid && !amountError;

  const handleInvest = async () => {
    if (networkGuard.blocked) return;
    const result = parseXlmToStroops(amount);
    if (!result.valid) {
      setAmountError(result.error);
      return;
    }
    setAmountError(null);
    await invest({
      campaignId,
      onChainCampaignId,
      investorAddress,
      amount: result.stroops,
    });
  };

  useEffect(() => {
    if (success) {
      onIndexed();
      const timer = setTimeout(() => {
        onClose();
        setAmount("");
        setAmountError(null);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [success, onClose, onIndexed]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && !loading) {
      onClose();
    }
    if (e.key === "Tab" && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
  }, [loading, onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      closeRef.current?.focus();
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Invest in campaign"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div ref={modalRef} className="bg-background text-foreground p-6 rounded-lg shadow-xl max-w-sm w-full">
        <h2 className="text-xl font-semibold mb-4 text-primary-600">
          Invest in campaign
        </h2>
        <div>
          <label htmlFor="invest-amount" className="block text-sm font-medium text-foreground mb-1">
            Amount (XLM)
          </label>
          <input
            id="invest-amount"
            type="text"
            inputMode="decimal"
            min="0.0000001"
            step="0.0000001"
            placeholder="Amount"
            value={amount}
            onChange={e => handleAmountChange(e.target.value)}
            aria-invalid={!!amountError}
            aria-describedby={amountError ? "invest-amount-error" : undefined}
            className={`w-full p-2 border rounded mb-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 ${amountError ? "border-red-400 focus:ring-red-400" : "border-border"}`}
          />
          {amountError && (
            <p id="invest-amount-error" className="text-xs text-error mb-2" role="alert">{amountError}</p>
          )}
        </div>
        <p className="mt-2 mb-1 text-xs text-muted" data-testid="invest-fee-estimate">
          Estimated network fee: <span className="font-medium text-foreground">{feeDisplay}</span>
          {feeEstimate && !feeEstimate.fromNetwork && " (network minimum)"}
          {feeEstimate?.fromNetwork &&
            ` (${feeEstimate.percentile} of recent fees — adjusts with congestion)`}
        </p>
        {networkGuard.blocked && networkGuard.reason && (
          <p className="mt-2 mb-1 text-xs text-error" role="alert" data-testid="invest-network-guard">
            {networkGuard.reason}
          </p>
        )}
        <button
          onClick={handleInvest}
          disabled={loading || awaitingIndex || !isFormValid || networkGuard.blocked}
          aria-label={
            networkGuard.blocked
              ? "Investment blocked: switch your wallet network"
              : loading
                ? "Processing investment"
                : !isFormValid
                  ? "Enter a valid amount to invest"
                  : "Invest in campaign"
          }
          className="w-full py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <ButtonSpinner />}
          {loading ? `${phase.replace("_", " ")}…` : "Invest"}
        </button>
        {error && (
          <p className="mt-2 text-sm text-error" role="alert">{error}</p>
        )}
        {success && (
          <p className="mt-2 text-sm text-success" role="status">Investment confirmed and indexed.</p>
        )}
        {awaitingIndex && (
          <div className="mt-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800" role="status">
            <p>Your investment is confirmed on-chain and is waiting for the indexer.</p>
            {txHash && <p className="mt-1 break-all font-mono text-xs">Transaction: {txHash}</p>}
            <button
              onClick={() => void retryIndexing()}
              className="mt-2 text-sm font-medium underline"
              aria-label="Refresh investment indexing status"
            >
              Refresh status
            </button>
          </div>
        )}
        <button
          ref={closeRef}
          onClick={onClose}
          disabled={loading}
          className="mt-4 text-sm underline text-primary-600"
          aria-label="Cancel investment"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
