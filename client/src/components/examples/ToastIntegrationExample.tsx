"use client";

/**
 * Example: Using toast notifications + integrating with existing EscrowTransaction flow
 */

import { useState } from "react";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackToast } from "@/components/TransactionFeedbackToast";
import { Button } from "@/components/ui/Button";
import { Container, Card, CardContent } from "@/components/ui";

const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

export default function ToastIntegrationExample() {
  const { pending, confirming, success, failure } = useTransactionFeedback();
  const [loading, setLoading] = useState(false);

  const handleEscrowTransaction = async () => {
    setLoading(true);
    try {
      pending("Building escrow order...");

      // Step 1: Build unsigned XDR (simulated)
      await new Promise((r) => setTimeout(r, 1000));

      confirming("Awaiting wallet signature...");

      // Step 2: Sign and submit (simulated)
      await new Promise((r) => setTimeout(r, 2000));

      // Step 3: Success
      const txHash = "abcd1234efgh5678ijkl9012mnop3456qrst7890uvwx1234yz";
      success(txHash);
    } catch (err) {
      failure(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container size="md" className="py-8 space-y-6">
      {/* Toast notifications will appear here */}
      <TransactionFeedbackToast
        getTxUrl={(hash) => `${STELLAR_TESTNET_EXPLORER}${hash}`}
        showExplorerLink
        successDismissMs={5000}
        errorDismissMs={8000}
      />

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-xl font-semibold">Create Escrow Order</h2>
          <p className="text-muted">
            Click below to simulate creating an escrow transaction with toast
            feedback.
          </p>

          <Button
            onClick={handleEscrowTransaction}
            disabled={loading}
            fullWidth
          >
            {loading ? "Processing..." : "Create Escrow Order"}
          </Button>
        </CardContent>
      </Card>
    </Container>
  );
}
