"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Text,
} from "@/components/ui";
import {
  markDelivered,
  confirmReceipt,
  submitSignedTransaction,
} from "@/services/stellar/contractService";
import FreighterApi from "@stellar/freighter-api";

const BUYER_WINDOW_SECONDS = 96 * 60 * 60;

interface DeliveryConfirmationProps {
  orderId: bigint;
  farmerAddress: string;
  buyerAddress: string;
  status: "Pending" | "Delivered" | "Completed" | "Refunded";
  deliveryTimestamp?: number;
  connectedAddress: string;
  onStatusChange?: () => void;
}

type TxStatus = "idle" | "pending" | "success" | "error";

export default function DeliveryConfirmation({
  orderId,
  farmerAddress,
  buyerAddress,
  status,
  deliveryTimestamp,
  connectedAddress,
  onStatusChange,
}: DeliveryConfirmationProps) {
  const isFarmer = connectedAddress === farmerAddress;
  const isBuyer = connectedAddress === buyerAddress;
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>();
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    if (status !== "Delivered" || !deliveryTimestamp) return;
    const deadline = deliveryTimestamp + BUYER_WINDOW_SECONDS;
    const tick = () =>
      setTimeLeft(Math.max(0, deadline - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, deliveryTimestamp]);

  const formatTimeLeft = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m remaining`;
  };

  const handleMarkDelivered = async () => {
    setTxStatus("pending");
    setErrorMsg(undefined);
    try {
      const result = await markDelivered(farmerAddress, orderId);
      if (!result.success || !result.data) throw new Error(result.error);
      const signed = await FreighterApi.signTransaction(result.data);
      if (!signed) throw new Error("Transaction rejected by wallet");
      const submitted = await submitSignedTransaction(signed);
      if (!submitted.success) throw new Error(submitted.error);
      setTxStatus("success");
      onStatusChange?.();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setTxStatus("error");
    }
  };

  const handleConfirmReceipt = async () => {
    setTxStatus("pending");
    setErrorMsg(undefined);
    try {
      const result = await confirmReceipt(buyerAddress, orderId);
      if (!result.success || !result.data) throw new Error(result.error);
      const signed = await FreighterApi.signTransaction(result.data);
      if (!signed) throw new Error("Transaction rejected by wallet");
      const submitted = await submitSignedTransaction(signed);
      if (!submitted.success) throw new Error(submitted.error);
      setTxStatus("success");
      onStatusChange?.();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setTxStatus("error");
    }
  };

  if (status === "Completed" || status === "Refunded") return null;

  const isProcessing = txStatus === "pending";

  return (
    <Card variant="elevated" padding="lg">
      <CardHeader>
        <CardTitle>Delivery Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {status === "Pending" && isFarmer && (
          <>
            <Text variant="body" muted>
              Once you have dispatched the goods, mark this order as delivered.
              The buyer will have 96 hours to confirm receipt.
            </Text>
            <Button
              variant="primary"
              onClick={handleMarkDelivered}
              disabled={isProcessing}
            >
              {isProcessing ? "Processing..." : "Mark as Delivered"}
            </Button>
          </>
        )}

        {status === "Pending" && isBuyer && (
          <Text variant="body" muted>
            Waiting for the farmer to mark this order as delivered.
          </Text>
        )}

        {status === "Delivered" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="warning">Awaiting confirmation</Badge>
              {timeLeft > 0 && (
                <Text variant="body" muted className="text-sm">
                  {formatTimeLeft(timeLeft)}
                </Text>
              )}
            </div>
            {deliveryTimestamp && (
              <Text variant="body" muted className="text-xs">
                Marked delivered:{" "}
                {new Date(deliveryTimestamp * 1000).toLocaleString()}
              </Text>
            )}
            {isBuyer && (
              <>
                <Text variant="body" className="text-sm">
                  Have you received the goods? Confirming releases payment to
                  the farmer.
                </Text>
                <Button
                  variant="primary"
                  onClick={handleConfirmReceipt}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Processing..." : "Confirm Receipt"}
                </Button>
              </>
            )}
            {isFarmer && (
              <Text variant="body" muted className="text-sm">
                Waiting for the buyer to confirm receipt.
              </Text>
            )}
          </div>
        )}

        {txStatus === "error" && errorMsg && (
          <Text
            variant="body"
            className="text-sm"
            style={{ color: "var(--color-text-danger)" }}
          >
            {errorMsg}
          </Text>
        )}

        {txStatus === "success" && (
          <Badge variant="success">Transaction confirmed</Badge>
        )}
      </CardContent>
    </Card>
  );
}
