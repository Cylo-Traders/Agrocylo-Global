"use client";

import React, { useState, useContext } from "react";
import {
  Container,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Text,
  Input,
} from "@/components/ui";
import { WalletContext } from "@/context/WalletContext";
import {
  notifyTransactionSubmitted,
  notifyTransactionConfirmed,
  notifyTransactionFailed,
  notifyTransactionConfirming,
} from "@/services/notification";

interface EscrowTransactionProps {
  farmerAddress: string;
  tokenAddress: string;
  pricePerUnit: number;
  productName: string;
}

interface TransactionStatus {
  status: "idle" | "pending" | "confirming" | "success" | "error";
  message?: string;
  txHash?: string;
}

export default function EscrowTransaction({
  farmerAddress,
  tokenAddress,
  pricePerUnit,
  productName,
}: EscrowTransactionProps) {
  const { address, connected, network } = useContext(WalletContext);
  const [quantity, setQuantity] = useState<string>("1");
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [transactionStatus, setTransactionStatus] = useState<TransactionStatus>({
    status: "idle",
  });

  const totalPrice = parseFloat(quantity || "0") * pricePerUnit;
  const totalAmount = Math.floor(totalPrice * 10000000); // Convert to stroops (7 decimal places)

  const validateForm = (): boolean => {
    if (!quantity || parseFloat(quantity) <= 0) {
      setTransactionStatus({
        status: "error",
        message: "Please enter a valid quantity",
      });
      return false;
    }

    if (!deliveryDeadline) {
      setTransactionStatus({
        status: "error",
        message: "Please select a delivery deadline",
      });
      return false;
    }

    const deadline = new Date(deliveryDeadline);
    if (deadline <= new Date()) {
      setTransactionStatus({
        status: "error",
        message: "Delivery deadline must be in the future",
      });
      return false;
    }

    return true;
  };

  const callCreateOrder = async () => {
    if (!validateForm()) return;

    setTransactionStatus({ status: "pending", message: "Preparing transaction..." });

    try {
      if (!connected || !address) {
        throw new Error("Please connect your wallet first");
      }

      setTransactionStatus({
        status: "confirming",
        message: "Please confirm the transaction in your wallet...",
      });
      notifyTransactionConfirming();

      const { createEscrowService } = await import("../lib/contract");
      const contractService = createEscrowService("ESCROW_CONTRACT_ID_PLACEHOLDER");

      const result = await contractService.createOrder({
        buyerAddress: address,
        farmerAddress: farmerAddress,
        tokenAddress: tokenAddress,
        amount: totalAmount,
        contractId: "ESCROW_CONTRACT_ID_PLACEHOLDER",
      });

      if (result.success) {
        notifyTransactionSubmitted(result.txHash);
        setTimeout(() => {
          notifyTransactionConfirmed(result.txHash);
        }, 2000);
        setTransactionStatus({
          status: "success",
          message: "Transaction successful! Order created.",
          txHash: result.txHash,
        });
      } else {
        throw new Error(result.error || "Transaction failed");
      }
    } catch (error) {
      console.error("Transaction error:", error);
      const errorMessage = error instanceof Error
        ? error.message
        : "Transaction failed. Please try again.";
      notifyTransactionFailed(errorMessage);
      setTransactionStatus({
        status: "error",
        message: errorMessage,
      });
    }
  };

  const getStatusColor = (): "default" | "primary" | "secondary" | "success" | "warning" | "error" | "outline" => {
    switch (transactionStatus.status) {
      case "pending":
      case "confirming":
        return "warning";
      case "success":
        return "success";
      case "error":
        return "error";
      default:
        return "primary";
    }
  };

  const getStatusText = () => {
    switch (transactionStatus.status) {
      case "pending":
        return "Preparing...";
      case "confirming":
        return "Awaiting Confirmation";
      case "success":
        return "Success";
      case "error":
        return "Error";
      default:
        return "Ready";
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
      <Card variant="elevated" padding="lg">
        <CardHeader>
          <CardTitle>Escrow Transaction</CardTitle>
          <Text variant="body" muted>
            Create a secure escrow transaction for {productName}
          </Text>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Product Details */}
          <div className="bg-muted/50 p-4 rounded-lg">
            <Text variant="h4" as="h4" className="mb-2">
              Order Details
            </Text>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Text variant="body" muted className="text-sm">
                  Product
                </Text>
                <Text variant="body" className="font-medium">
                  {productName}
                </Text>
              </div>
              <div>
                <Text variant="body" muted className="text-sm">
                  Price per Unit
                </Text>
                <Text variant="body" className="font-medium">
                  {pricePerUnit} XLM
                </Text>
              </div>
              <div>
                <Text variant="body" muted className="text-sm">
                  Farmer Address
                </Text>
                <Text variant="body" className="font-mono text-xs break-all">
                  {farmerAddress}
                </Text>
              </div>
              <div>
                <Text variant="body" muted className="text-sm">
                  Network
                </Text>
                <Badge variant="outline">{network}</Badge>
              </div>
            </div>
          </div>

          {/* Quantity Input */}
          <div>
            <Input
              label="Quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="Enter quantity"
              hint="Number of units you want to purchase"
            />
          </div>

          {/* Total Price Display */}
          <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg">
            <div className="flex justify-between items-center">
              <Text variant="h4" as="h4">
                Total Price
              </Text>
              <Text variant="h3" as="h3" className="text-primary">
                {totalPrice.toFixed(2)} XLM
              </Text>
            </div>
            <Text variant="body" muted className="text-sm mt-1">
              {quantity} units × {pricePerUnit} XLM per unit
            </Text>
          </div>

          {/* Delivery Deadline */}
          <div>
            <Input
              label="Delivery Deadline"
              type="datetime-local"
              value={deliveryDeadline}
              onChange={(e) => setDeliveryDeadline(e.target.value)}
              hint="Expected delivery date and time"
            />
          </div>

          {/* Transaction Status */}
          {transactionStatus.status !== "idle" && (
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={getStatusColor()}>
                  {getStatusText()}
                </Badge>
              </div>
              {transactionStatus.message && (
                <Text variant="body" className="text-sm">
                  {transactionStatus.message}
                </Text>
              )}
              {transactionStatus.txHash && (
                <div className="mt-2">
                  <Text variant="body" muted className="text-xs">
                    Transaction Hash:{" "}
                    <span className="font-mono break-all">
                      {transactionStatus.txHash}
                    </span>
                  </Text>
                </div>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={callCreateOrder}
            disabled={
              transactionStatus.status === "pending" ||
              transactionStatus.status === "confirming"
            }
            className="flex-1"
          >
            {transactionStatus.status === "pending" ||
            transactionStatus.status === "confirming"
              ? "Processing..."
              : "Create Escrow Order"}
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setQuantity("1");
              setDeliveryDeadline("");
              setTransactionStatus({ status: "idle" });
            }}
            disabled={
              transactionStatus.status === "pending" ||
              transactionStatus.status === "confirming"
            }
          >
            Reset
          </Button>
        </CardFooter>
      </Card>
    </Container>
  );
}
