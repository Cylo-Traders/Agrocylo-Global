import { useCallback, useRef, useState } from "react";
import { buildInvest } from "@/lib/contractService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import {
  InvestmentIndexingTimeoutError,
  resolveIndexedInvestment,
  waitForIndexedInvestment,
} from "@/services/investmentService";
import type { Investment } from "@/types";
import { useWebSocket } from "./useWebSocket";

export type InvestmentPhase =
  | "idle"
  | "building"
  | "signing"
  | "submitting"
  | "confirming"
  | "indexing"
  | "awaiting_index"
  | "indexed"
  | "failed";

export interface InvestmentRequest {
  campaignId: string;
  onChainCampaignId: string;
  investorAddress: string;
  amount: bigint;
}

export function useInvest() {
  // Resolve any pending waitForIndexedInvestment call as soon as the server
  // emits the investment.indexed WebSocket event, avoiding REST polling.
  useWebSocket((msg) => {
    if (msg.event === "investment.indexed") {
      const payload = msg.payload as Investment & { txHash?: string };
      if (payload.txHash) resolveIndexedInvestment(payload.txHash, payload);
    }
  });

  const [phase, setPhase] = useState<InvestmentPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [investment, setInvestment] = useState<Investment | null>(null);
  const requestRef = useRef<InvestmentRequest | null>(null);
  const inFlightRef = useRef(false);

  const indexConfirmedInvestment = useCallback(async (request: InvestmentRequest, hash: string) => {
    setPhase("indexing");
    const indexed = await waitForIndexedInvestment({
      campaignId: request.campaignId,
      investorAddress: request.investorAddress,
      amount: request.amount.toString(),
      txHash: hash,
    });
    setInvestment(indexed);
    setPhase("indexed");
    return indexed;
  }, []);

  const invest = useCallback(async (request: InvestmentRequest): Promise<Investment | null> => {
    // A ref closes the gap before React has applied the loading state, so a
    // double-click can never create two wallet-signing requests.
    if (inFlightRef.current || phase === "indexing" || phase === "awaiting_index") return null;

    inFlightRef.current = true;
    requestRef.current = request;
    setError(null);
    setInvestment(null);
    setTxHash(null);
    try {
      setPhase("building");
      const built = await buildInvest(
        request.investorAddress,
        request.onChainCampaignId,
        request.amount,
      );
      if (!built.success || !built.data) {
        throw new Error(built.error ?? "Could not build the investment transaction");
      }

      const submitted = await signAndSubmitTransaction(built.data, setPhase);
      if (!submitted.success || !submitted.txHash) {
        throw new Error(submitted.error ?? "Investment transaction was not confirmed on-chain");
      }

      setTxHash(submitted.txHash);
      return await indexConfirmedInvestment(request, submitted.txHash);
    } catch (error: unknown) {
      if (error instanceof InvestmentIndexingTimeoutError) {
        // The transfer has already succeeded. Keep the caller in recovery
        // mode rather than allowing a duplicate investment submission.
        setPhase("awaiting_index");
        setError("Investment is confirmed on-chain and is still being indexed. Refresh its status; do not submit again.");
        return null;
      }
      setPhase("failed");
      setError(error instanceof Error ? error.message : "Investment failed. Please try again.");
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [indexConfirmedInvestment, phase]);

  const retryIndexing = useCallback(async (): Promise<Investment | null> => {
    const request = requestRef.current;
    if (!request || !txHash || inFlightRef.current) return null;

    inFlightRef.current = true;
    setError(null);
    try {
      return await indexConfirmedInvestment(request, txHash);
    } catch (error) {
      if (error instanceof InvestmentIndexingTimeoutError) {
        setPhase("awaiting_index");
        setError("Investment is confirmed on-chain and is still being indexed. Try refreshing shortly.");
        return null;
      }
      setPhase("failed");
      setError(error instanceof Error ? error.message : "Could not refresh investment status.");
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [indexConfirmedInvestment, txHash]);

  return {
    invest,
    retryIndexing,
    phase,
    loading: ["building", "signing", "submitting", "confirming", "indexing"].includes(phase),
    error,
    success: phase === "indexed",
    txHash,
    investment,
  };
}
