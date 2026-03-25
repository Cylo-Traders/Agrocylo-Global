"use client";

import React from "react";
import { Button, Card, CardContent, Text, Badge } from "@/components/ui";

export type TransactionState =
  | "idle"
  | "preparing"
  | "waiting_signature"
  | "submitting"
  | "confirming"
  | "success"
  | "failed";

export interface TransactionStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: TransactionState;
  txHash?: string;
  errorMessage?: string;
}

interface StateConfig {
  label: string;
  badgeVariant: "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline";
  showSpinner: boolean;
}

const stateConfig: Record<Exclude<TransactionState, "idle">, StateConfig> = {
  preparing: {
    label: "Preparing transaction",
    badgeVariant: "primary",
    showSpinner: true,
  },
  waiting_signature: {
    label: "Waiting for wallet signature",
    badgeVariant: "warning",
    showSpinner: true,
  },
  submitting: {
    label: "Submitting transaction",
    badgeVariant: "primary",
    showSpinner: true,
  },
  confirming: {
    label: "Confirming on network",
    badgeVariant: "warning",
    showSpinner: true,
  },
  success: {
    label: "Transaction successful",
    badgeVariant: "success",
    showSpinner: false,
  },
  failed: {
    label: "Transaction failed",
    badgeVariant: "error",
    showSpinner: false,
  },
};

export function TransactionStatusModal({
  isOpen,
  onClose,
  state,
  txHash,
  errorMessage,
}: TransactionStatusModalProps) {
  if (!isOpen || state === "idle") {
    return null;
  }

  const config = stateConfig[state];
  const isTerminal = state === "success" || state === "failed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={isTerminal ? onClose : undefined}
        aria-hidden="true"
      />
      <Card
        variant="elevated"
        padding="lg"
        className="relative w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-modal-title"
      >
        <CardContent className="text-center space-y-6">
          <div className="flex justify-center">
            {config.showSpinner ? (
              <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center">
                <div className="size-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              </div>
            ) : state === "success" ? (
              <div className="size-16 rounded-full bg-success/10 flex items-center justify-center">
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
              </div>
            ) : (
              <div className="size-16 rounded-full bg-error/10 flex items-center justify-center">
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
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Text id="transaction-modal-title" variant="h3" as="h3">
              {config.label}
            </Text>
            <Badge variant={config.badgeVariant}>{state.replace(/_/g, " ")}</Badge>
          </div>

          {txHash && (
            <div className="bg-muted/50 p-3 rounded-lg">
              <Text variant="caption" muted className="block mb-1">
                Transaction Hash
              </Text>
              <Text
                variant="bodySmall"
                className="font-mono text-xs break-all"
              >
                {txHash}
              </Text>
            </div>
          )}

          {errorMessage && (
            <div className="bg-error/10 border border-error/20 p-3 rounded-lg">
              <Text variant="bodySmall" className="text-error">
                {errorMessage}
              </Text>
            </div>
          )}

          {isTerminal && (
            <Button variant="primary" onClick={onClose} fullWidth>
              Close
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TransactionStatusModal;
