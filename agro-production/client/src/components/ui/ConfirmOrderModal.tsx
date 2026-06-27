import { useState, useCallback, useRef, useEffect } from "react";
import { formatAmount } from "@/services/campaignService";
import { ButtonSpinner } from "@/components/Skeletons";
import type { Order } from "@/types";

interface ConfirmOrderModalProps {
  open: boolean;
  order: Order | null;
  onClose: () => void;
  onConfirm: (orderId: string) => Promise<void>;
}

export default function ConfirmOrderModal({
  open,
  order,
  onClose,
  onConfirm,
}: ConfirmOrderModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const handleConfirm = async () => {
    if (!order) return;
    setLoading(true);
    setError(null);

    try {
      await onConfirm(order.id);
      setSuccess(true);

      // Auto-close after success
      const timer = setTimeout(() => {
        onClose();
        setSuccess(false);
        setLoading(false);
      }, 1500);

      return () => clearTimeout(timer);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to confirm receipt. Please try again."
      );
      setLoading(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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
    },
    [loading, onClose]
  );

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

  if (!open || !order) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm order receipt"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="bg-background text-foreground p-6 rounded-lg shadow-xl max-w-sm w-full"
      >
        <h2 className="text-xl font-semibold mb-4 text-primary-600">
          Confirm Order Receipt
        </h2>

        {/* Order summary */}
        <div className="border border-border rounded-lg p-4 mb-4 space-y-2 bg-surface text-sm">
          <p className="text-muted">
            Order ID: <span className="font-mono text-foreground">{order.id.slice(0, 8)}…</span>
          </p>
          <p className="text-muted">
            Amount: <span className="font-semibold text-foreground">{formatAmount(order.amount)} XLM</span>
          </p>
          <p className="text-muted">
            Status: <span className="font-semibold text-foreground">{order.status}</span>
          </p>
          <p className="text-xs text-muted mt-2">
            Confirming receipt marks this order as received. On-chain escrow funds can only be released by the smart contract.
          </p>
        </div>

        {/* Success state */}
        {success && (
          <div
            className="border border-green-200 bg-green-50 rounded-lg p-4 mb-4 text-green-800 text-sm"
            role="status"
          >
            <p className="font-semibold">✓ Receipt Confirmed</p>
            <p className="mt-1 text-xs">Order marked as received.</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div
            className="border border-red-200 bg-red-50 rounded-lg p-4 mb-4 text-red-700 text-sm"
            role="alert"
          >
            <p className="font-semibold mb-1">Error</p>
            <p className="text-sm">{error}</p>
            <button
              onClick={() => void handleConfirm()}
              disabled={loading}
              className="mt-2 text-xs font-medium underline text-red-600 hover:text-red-800 disabled:opacity-50"
              aria-label="Retry confirming receipt"
            >
              Retry
            </button>
          </div>
        )}

        {/* Buttons */}
        <div className="space-y-2">
          <button
            onClick={() => void handleConfirm()}
            disabled={loading || success}
            aria-label={loading ? "Confirming receipt" : "Confirm order receipt"}
            className="w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 font-medium inline-flex items-center justify-center gap-2 text-sm"
          >
            {loading && <ButtonSpinner />}
            {loading ? "Confirming…" : success ? "Confirmed" : "Confirm Receipt"}
          </button>

          <button
            ref={closeRef}
            onClick={onClose}
            disabled={loading}
            className="w-full py-2 text-sm text-muted hover:text-foreground underline disabled:opacity-50"
            aria-label="Close confirmation dialog"
          >
            {success ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
