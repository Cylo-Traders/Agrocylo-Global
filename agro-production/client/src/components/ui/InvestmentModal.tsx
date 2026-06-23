import { useState, useEffect, useCallback, useRef } from 'react';
import { useInvest } from '@/hooks/useInvest';
import { validateAmount } from '@/lib/validation';
import { ButtonSpinner } from '@/components/Skeletons';
import { useWallet } from '@/context/WalletContext';
import type { CampaignDetail } from '@/types';
import type { InvestStep, InvestStepState, StepStatus } from '@/types/transaction';

interface InvestmentModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Pick<CampaignDetail, 'id' | 'onChainId'>;
}

const STEP_LABELS: Record<InvestStep, string> = {
  build: "Build transaction",
  sign: "Sign transaction",
  submit: "Submit to Stellar",
  confirm: "Confirmed",
  refresh: "Update records",
};

const STEP_DESCS: Record<InvestStep, string> = {
  build: "Preparing transaction envelope",
  sign: "Waiting for your wallet signature",
  submit: "Broadcasting transaction to the network",
  confirm: "Investment confirmed on the Stellar ledger",
  refresh: "Synchronizing investment status",
};

const STEPS: InvestStep[] = ["build", "sign", "submit", "confirm", "refresh"];

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-white text-sm font-bold shrink-0" aria-hidden="true">
        ✓
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white text-sm font-bold shrink-0" aria-hidden="true">
        ✗
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary-600 bg-primary-50 shrink-0" aria-hidden="true">
        <ButtonSpinner className="text-primary-600" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-border bg-surface text-muted text-xs shrink-0" aria-hidden="true">
      ○
    </span>
  );
}

function connector(status: StepStatus) {
  return (
    <div
      className={`mx-4 w-0.5 h-6 transition-colors duration-300 ${status === "done" ? "bg-primary-600" : "bg-border"}`}
      aria-hidden="true"
    />
  );
}

function InvestProgress({ steps, txHash }: { steps: InvestStepState; txHash?: string }) {
  return (
    <div className="border border-border rounded-xl p-5 bg-surface mt-4" role="status" aria-live="polite">
      <p className="text-sm font-semibold text-foreground mb-4">Investment Progress</p>
      <ol className="space-y-0" aria-label="Investment steps">
        {STEPS.map((step, idx) => {
          const status = steps[step];
          return (
            <li key={step}>
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <StepIcon status={status} />
                  {idx < STEPS.length - 1 && connector(status)}
                </div>
                <div className="pb-6">
                  <p className={`text-sm font-medium leading-tight ${status === "idle" ? "text-muted" : "text-foreground"} ${status === "error" ? "text-red-600" : ""}`}>
                    {STEP_LABELS[step]}
                  </p>
                  {status !== "idle" && (
                    <p className="text-xs text-muted mt-0.5">{STEP_DESCS[step]}</p>
                  )}
                  {step === "confirm" && status === "done" && txHash && (
                    <p className="text-xs font-mono text-muted mt-1 break-all">
                      Tx: {txHash.slice(0, 16)}…{txHash.slice(-8)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function InvestmentModal({ open, onClose, campaign }: InvestmentModalProps) {
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  const { machine, invest, reset } = useInvest();
  const { address } = useWallet();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loading = machine.phase !== "idle" && machine.phase !== "success" && machine.phase !== "failed";
  const success = machine.phase === "success";

  function handleAmountChange(raw: string) {
    setAmount(raw);
    if (!raw) {
      setAmountError(null);
      return;
    }
    const result = validateAmount(raw, 0);
    setAmountError(result.valid ? null : result.error);
  }

  const isFormValid = !!amount && !amountError && validateAmount(amount, 0).valid && !!address;

  const handleInvest = async () => {
    if (!address) return;
    const result = validateAmount(amount, 0);
    if (!result.valid) {
      setAmountError(result.error);
      return;
    }
    setAmountError(null);
    const value = BigInt(result.sanitized);
    if (value <= 0n) return;
    await invest(campaign.id, campaign.onChainId, address, value);
  };

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        onClose();
        setAmount('');
        setAmountError(null);
        reset();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [success, onClose, reset]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && !loading) {
      onClose();
      reset();
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
  }, [loading, onClose, reset]);

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
      className="fixed inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Invest in campaign"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) { onClose(); reset(); } }}
    >
      <div ref={modalRef} className="bg-background text-foreground p-6 rounded-lg shadow-xl max-w-md w-full my-8">
        <h2 className="text-xl font-semibold mb-4 text-primary-600">
          Invest in campaign
        </h2>
        
        {machine.phase === "idle" || machine.phase === "failed" ? (
          <>
            <div>
              <label htmlFor="invest-amount" className="block text-sm font-medium text-foreground mb-1">
                Amount (XLM)
              </label>
              <input
                id="invest-amount"
                type="number"
                min="1"
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
              {!address && (
                <p className="text-xs text-error mb-2" role="alert">Please connect your wallet first</p>
              )}
            </div>
            
            <button
              onClick={handleInvest}
              disabled={!isFormValid}
              aria-label={!isFormValid ? "Enter a valid amount to invest" : "Invest"}
              className="w-full py-2 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 inline-flex items-center justify-center gap-2 mt-2"
            >
              Invest
            </button>
            
            {machine.error && (
              <p className="mt-4 text-sm text-error bg-red-50 p-3 rounded-lg border border-red-200" role="alert">{machine.error}</p>
            )}
          </>
        ) : (
          <InvestProgress steps={machine.steps} txHash={machine.txHash} />
        )}
        
        {success && (
          <p className="mt-4 text-sm font-semibold text-primary-600 text-center" role="status">Investment successful! Refreshing...</p>
        )}
        
        <button
          ref={closeRef}
          onClick={() => { onClose(); reset(); }}
          disabled={loading}
          className="mt-4 text-sm underline text-primary-600 w-full text-center disabled:opacity-50"
          aria-label="Close"
        >
          {success || machine.phase === "failed" ? "Close" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
