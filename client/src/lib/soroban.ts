import { rpc } from "@stellar/stellar-sdk";
import { getRpcServer } from "./stellar";

export interface TransactionStatusResult {
  status: "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND" | "TIMEOUT";
  txHash: string;
  resultXdr?: string;
  error?: string;
  response?: rpc.Api.GetTransactionResponse;
}

/**
 * Polls the Soroban RPC for the status of a transaction.
 * @param txHash The hash of the transaction to check.
 * @param timeoutMs Total timeout in milliseconds (default 60s).
 * @param intervalMs Polling interval in milliseconds (default 2s).
 */
export async function checkTransactionStatus(
  txHash: string,
  timeoutMs: number = 60000,
  intervalMs: number = 2000
): Promise<TransactionStatusResult> {
  const rpcServer = await getRpcServer();
  const startTime = Date.now();

  console.log(`Starting poll for transaction: ${txHash}`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await rpcServer.getTransaction(txHash);

      if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        console.log(`Transaction ${txHash} succeeded`);
        return {
          status: "SUCCESS",
          txHash,
          resultXdr: response.resultMetaXdr?.toXDR("base64"),
          response,
        };
      }

      if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
        console.error(`Transaction ${txHash} failed`);
        return {
          status: "FAILED",
          txHash,
          resultXdr: response.resultMetaXdr?.toXDR("base64"),
          error: "Transaction failed on-chain",
          response,
        };
      }

      if (response.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
        console.log(`Transaction ${txHash} not found yet, retrying...`);
      }
    } catch (error) {
      console.warn(`Error checking transaction ${txHash}:`, error);
      // We don't abort on transient RPC errors, just log and continue until timeout
    }

    // Wait for the next poll interval
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.error(`Transaction ${txHash} polling timed out`);
  return {
    status: "TIMEOUT",
    txHash,
    error: `Transaction polling timed out after ${timeoutMs / 1000} seconds`,
  };
}
