"use client";

/**
 * Example: Using the modal variant + Stellar block explorer integration
 */

import { useState } from "react";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui";

const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

export default function ModalExample() {
  const { executeTransaction } = useTransactionFeedback();
  const [modalOpen, setModalOpen] = useState(false);

  const handleTransaction = async () => {
    setModalOpen(true);

    const result = await executeTransaction(async () => {
      // Simulate signing and submitting a real transaction
      await new Promise((r) => setTimeout(r, 1500));

      // In real usage, this comes from signAndSubmitTransaction()
      const mockTxHash = "9f5f2c5af5f2c5af5f2c5af5f2c5af5f2c5af5f2c5af5f2c5af5f2c5a";
      return { txHash: mockTxHash };
    });

    console.log("Transaction result:", result);
    // Modal will stay open for user to view
  };

  return (
    <Container size="md" className="py-8">
      <Button onClick={handleTransaction} disabled={modalOpen}>
        Start Transaction (Modal)
      </Button>

      <TransactionFeedbackPanel
        variant="modal"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        autoDismissMs={0} // Manual dismiss
        getTxUrl={(hash) => `${STELLAR_TESTNET_EXPLORER}${hash}`}
        showCopyButton
        showExplorerLink
      />
    </Container>
  );
}
