"use client";

import React, { useContext, useCallback, useState } from "react";
import { TransactionFeedbackContext } from "@/context/TransactionFeedbackContext";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Text } from "@/components/ui/Text";
import type { TransactionState } from "@/types/transaction";

export interface TransactionFeedbackPanelProps {
  /**
   * Show as inline card (stacked with other content) vs. modal-like overlay
   * @default "inline"
   */
  variant?: "inline" | "modal";

  /**
   * Show the component. If false, nothing is rendered.
   * @default true
   */
  isOpen?: boolean;

  /**
   * Callback when user dismisses the feedback (success/failure states)
   */
  onClose?: () => void;

  /**
   * Auto-dismiss success state after N milliseconds. 0 = never auto-dismiss
   * @default 0
   */
  autoDismissMs?: number;

  /**
   * Show explorer link config
   * @default undefined
   */
  explorerConfig?: {
    baseUrl: string;
    txPath: string; // e.g., "/tx/%s" where %s is replaced with txHash
  };

  /**
   * Custom block explorer URL builder
   */
  getTxUrl?: (txHash: string) => string;

  /**
   * Show copy-to-clipboard button for txHash
   * @default true
   */
  showCopyButton?: boolean;

  /**
   * Show explorer link button
   * @default true
   */
  showExplorerLink?: boolean;
}

interface StateConfig {
  label: string;
  badge: string;
  badgeVariant: "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";
  icon: React.ReactNode;
  showSpinner: boolean;
}

const stateConfigs: Record<TransactionState, StateConfig> = {
  idle: {
    label: "Ready",
    badge: "idle",
    badgeVariant: "default",
    icon: null,
    showSpinner: false,
  },
  pending: {
    label: "Processing transaction...",
    badge: "pending",
    badgeVariant: "primary",
    icon: <div className="size-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />,
    showSpinner: true,
  },
  confirming: {
    label: "Awaiting blockchain confirmation...",
    badge: "confirming",
    badgeVariant: "warning",
    icon: <div className="size-10 rounded-full border-4 border-warning/20 border-t-warning animate-spin" />,
    showSpinner: true,
  },
  success: {
    label: "Transaction confirmed",
    badge: "success",
    badgeVariant: "success",
    icon: (
      <svg
        className="size-10 text-success"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
    ),
    showSpinner: false,
  },
  failure: {
    label: "Transaction failed",
    badge: "failure",
    badgeVariant: "error",
    icon: (
      <svg
        className="size-10 text-error"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    ),
    showSpinner: false,
  },
};

export function TransactionFeedbackPanel({
  variant = "inline",
  isOpen = true,
  onClose,
  autoDismissMs = 0,
  explorerConfig,
  getTxUrl,
  showCopyButton = true,
  showExplorerLink = true,
}: TransactionFeedbackPanelProps) {
  const context = useContext(TransactionFeedbackContext);
  const [copied, setCopied] = useState(false);

  // 1. Safely extract variables from context (avoids errors if context is undefined)
  const state = context?.feedback?.state || "idle";
  const txHash = context?.feedback?.txHash;
  const errorMessage = context?.feedback?.errorMessage;
  const message = context?.feedback?.message;
  const reset = context?.reset;

  // 2. Unconditionally call useEffect
  React.useEffect(() => {
    if (state === "success" && autoDismissMs > 0) {
      const timer = setTimeout(() => {
        reset?.();
        onClose?.();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [state, autoDismissMs, reset, onClose]);

  // 3. Unconditionally call useCallbacks
  const handleCopyTxHash = useCallback(async () => {
    if (!txHash) return;
    try {
      await navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy transaction hash:", err);
    }
  }, [txHash]);

  const handleClose = useCallback(() => {
    reset?.();
    onClose?.();
  }, [reset, onClose]);

  // 4. Place your early returns AFTER all hooks have executed
  if (!context) {
    console.warn("TransactionFeedbackPanel must be used within TransactionFeedbackProvider");
    return null;
  }

  const isTerminal = state === "success" || state === "failure";
  const isVisible = isOpen && state !== "idle";

  if (!isVisible) {
    return null;
  }

  // The rest of your component rendering logic remains exactly the same
  const config = stateConfigs[state];

  const blockExplorerUrl = getTxUrl ? getTxUrl(txHash || "") : null;

  const panelContent = (
    <div className="space-y-6">
      {/* Icon Section */}
      <div className="flex justify-center">
        <div className={`size-16 rounded-full flex items-center justify-center ${
          state === "pending" || state === "confirming" ? "bg-primary/10" :
          state === "success" ? "bg-success/10" :
          state === "failure" ? "bg-error/10" : "bg-neutral/10"
        }`}>
          {config.icon}
        </div>
      </div>

      {/* Title and Badge */}
      <div className="text-center space-y-2">
        <Text variant="h3" as="h3">
          {config.label}
        </Text>
        <Badge variant={config.badgeVariant}>
          {state.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* Status Message */}
      {message && message !== config.label && (
        <div className="text-center">
          <Text variant="body" muted>
            {message}
          </Text>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="bg-error/10 border border-error/20 rounded-lg p-3">
          <Text variant="bodySmall" className="text-error">
            {errorMessage}
          </Text>
        </div>
      )}

      {/* Transaction Hash Display */}
      {txHash && (
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <div>
            <Text variant="caption" muted className="block mb-2">
              Transaction Hash
            </Text>
            <Text
              variant="bodySmall"
              className="font-mono text-xs break-all leading-relaxed bg-surface rounded px-2 py-2"
            >
              {txHash}
            </Text>
          </div>

          {/* Transaction Hash Actions */}
          <div className="flex flex-col gap-2 sm:flex-row">
            {showCopyButton && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyTxHash}
                className="flex-1"
              >
                {copied ? "✓ Copied" : "Copy Hash"}
              </Button>
            )}

            {showExplorerLink && blockExplorerUrl && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => window.open(blockExplorerUrl, "_blank")}
              >
                View Explorer ↗
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (variant === "modal") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={isTerminal ? handleClose : undefined}
          aria-hidden="true"
        />
        <Card
          variant="elevated"
          padding="lg"
          className="relative w-full max-w-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tx-feedback-title"
        >
          <CardContent className="space-y-6">
            {panelContent}

            {/* Close Button */}
            {isTerminal && (
              <Button
                onClick={handleClose}
                variant="primary"
                fullWidth
                size="md"
              >
                Close
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Inline variant
  return (
    <Card
      variant="elevated"
      padding="lg"
      className="w-full"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <CardContent className="space-y-6">
        {panelContent}

        {/* Close Button for inline */}
        {isTerminal && onClose && (
          <Button
            onClick={handleClose}
            variant="outline"
            fullWidth
            size="md"
          >
            Dismiss
          </Button>
        )}
      </CardContent>
    </Card>
  );
}