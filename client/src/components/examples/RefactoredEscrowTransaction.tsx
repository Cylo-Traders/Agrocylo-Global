"use client";

/**
 * Example: Updating existing EscrowTransaction component to use the feedback system
 *
 * Shows how to refactor the callCreateOrder function to use TransactionFeedback.
 */

import { useState, useContext } from "react";
import { WalletContext } from "@/context/WalletContext";
import { useTransactionFeedback } from "@/hooks/useTransactionFeedback";
import { TransactionFeedbackPanel } from "@/components/TransactionFeedbackPanel";
import {
  Container,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Text,
  Input,
} from "@/components/ui";
import { mapBlockchainError } from "@/components/errorHandler";
import { createOrder } from "@/services/stellar/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";

interface RefactoredEscrowTransactionProps {
  farmerAddress: string;
  tokenAddress: string;
  pricePerUnit: number;
  productName: string;
}

const STELLAR_TESTNET_EXPLORER = "https://stellar.expert/explorer/testnet/tx/";

/**
 * Refactored version of EscrowTransaction using TransactionFeedback.
 * This replaces the manual transactionStatus state management.
 */
export default function RefactoredEscrowTransaction({
  farmerAddress,
  tokenAddress,
  pricePerUnit,
  productName,
}: RefactoredEscrowTransactionProps) {
  const { address, connected, network } = useContext(WalletContext);
  const { pending, confirming, success, failure, reset, isLoading } =
    useTransactionFeedback();

  const [quantity, setQuantity] = useState<string>("1");
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const totalPrice = parseFloat(quantity || "0") * pricePerUnit;
  const totalAmount = BigInt(Math.floor(totalPrice * 10_000_000));

  const validateForm = (): boolean => {
    if (!farmerAddress) {
      failure("Farmer address is missing.");
      setFeedbackOpen(true);
      return false;
    }

    if (!tokenAddress) {
      failure("Token contract address is missing.");
      setFeedbackOpen(true);
      return false;
    }

    if (!quantity || parseFloat(quantity) <= 0) {
      failure("Please enter a valid quantity");
      setFeedbackOpen(true);
      return false;
    }

    if (!deliveryDeadline) {
      failure("Please select a delivery deadline");
      setFeedbackOpen(true);
      return false;
    }

    const deadline = new Date(deliveryDeadline);
    if (deadline <= new Date()) {
      failure("Delivery deadline must be in the future");
      setFeedbackOpen(true);
      return false;
    }

    return true;
  };

  const callCreateOrder = async () => {
    if (!validateForm()) return;

    setFeedbackOpen(true);
    pending("Building escrow order transaction...");

    try {
      if (!connected || !address) {
        throw new Error("Please connect your wallet first");
      }

      const unsignedXdr = await createOrder(
        address,
        farmerAddress,
        tokenAddress,
        totalAmount,
        deliveryDeadline
      );

      if (!unsignedXdr.success || !unsignedXdr.data) {
        throw new Error(unsignedXdr.error || "Failed to build escrow transaction");
      }

      confirming("Please confirm the transaction in your wallet...");

      const signed = await signAndSubmitTransaction(unsignedXdr.data);
      if (!signed.success || !signed.txHash) {
        throw new Error(signed.error || "Transaction failed");
      }

      // Success!
      success(signed.txHash);

      // Optional: Reset form on success
      setQuantity("1");
      setDeliveryDeadline("");
    } catch (error) {
      console.error("Transaction error:", error);
      const errorInfo = mapBlockchainError(error);
      failure(`${errorInfo.title}: ${errorInfo.message}`);
    }
  };

  if (!connected) {
    return (
      <Container size="md" className="py-8">
        <Card variant="elevated" padding="lg">
          <CardContent className="text-center py-8">
            <Text variant="h3" as="h3" className="mb-4">
              Connect Wallet Required
            </Text>
            <Text variant="body" muted className="mb-6">
              Please connect your wallet to create an escrow transaction.
            </Text>
          </CardContent>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="md" className="py-8">
      {/* Feedback panel shows transaction state */}
      <TransactionFeedbackPanel
        variant="inline"
        isOpen={feedbackOpen}
        onClose={() => {
          setFeedbackOpen(false);
          reset();
        }}
        getTxUrl={(hash) => `${STELLAR_TESTNET_EXPLORER}${hash}`}
        showCopyButton
        showExplorerLink
      />

      {!feedbackOpen && (
        <Card variant="elevated" padding="lg">
          <CardHeader>
            <CardTitle>Create Escrow Order</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Product</label>
              <Input
                type="text"
                value={productName}
                disabled
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Quantity</label>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                className="mt-1"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Delivery Deadline</label>
              <Input
                type="datetime-local"
                value={deliveryDeadline}
                onChange={(e) => setDeliveryDeadline(e.target.value)}
                className="mt-1"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Total Price</label>
              <Input
                type="text"
                value={`${totalPrice.toFixed(2)}`}
                disabled
                className="mt-1"
              />
            </div>
          </CardContent>

          <CardFooter>
            <Button
              onClick={callCreateOrder}
              isLoading={isLoading}
              fullWidth
              size="lg"
            >
              Create Order
            </Button>
          </CardFooter>
        </Card>
      )}
    </Container>
  );
}
