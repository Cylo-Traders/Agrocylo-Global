"use client";

/**
 * Simple example: Using the panel variant (inline card UI)
 */

import { useState } from "react";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui";

export default function SimplePanelExample() {
  const { pending, success, failure, reset } = useTransactionFeedback();
  const [panelOpen, setPanelOpen] = useState(false);

  const simulateTransaction = async () => {
    try {
      setPanelOpen(true);
      pending("Building transaction...");

      // Simulate async work
      await new Promise((r) => setTimeout(r, 2000));

      // Mock tx hash
      const mockTxHash =
        "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a";
      success(mockTxHash);
    } catch (err) {
      failure(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <Container size="md" className="py-8">
      <Button
        onClick={simulateTransaction}
        disabled={panelOpen}
        className="mb-6"
      >
        Initiate Transaction
      </Button>

      <TransactionFeedbackPanel
        isOpen={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          reset();
        }}
        variant="inline"
        showCopyButton
        showExplorerLink
        getTxUrl={(hash) =>
          `https://stellar.expert/explorer/testnet/tx/${hash}`
        }
      />
    </Container>
  );
}
