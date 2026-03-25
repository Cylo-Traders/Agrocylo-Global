/**
 * Transaction Submission Service
 *
 * Submits signed Soroban transactions to the RPC with:
 *   - Automatic retry with exponential backoff for transient failures
 *   - Transaction status polling until confirmation
 *   - Typed error classes for different failure modes
 *
 * @example
 * ```ts
 * import { submitTransaction } from "@/components/submitTransaction";
 *
 * const result = await submitTransaction(signedXdr);
 * if (result.success) {
 *   console.log("Confirmed:", result.hash);
 * }
 * ```
 */

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import { getRpcServer, getCurrentNetworkName } from "@/lib/stellar";

// ── Error Classes ───────────────────────────────────────────────────────

/** Thrown when the Soroban RPC is unreachable or returns a non-parseable response. */
export class NetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Thrown when transaction polling exceeds the configured timeout. */
export class TimeoutError extends Error {
  public readonly hash: string;
  constructor(hash: string, timeoutMs: number) {
    super(
      `Transaction ${hash} was not confirmed within ${timeoutMs / 1000}s`
    );
    this.name = "TimeoutError";
    this.hash = hash;
  }
}

/** Thrown when the transaction reaches a terminal failure state on-chain. */
export class TransactionFailedError extends Error {
  public readonly hash: string;
  public readonly resultXdr?: string;
  constructor(hash: string, resultXdr?: string) {
    super(`Transaction ${hash} failed on-chain`);
    this.name = "TransactionFailedError";
    this.hash = hash;
    this.resultXdr = resultXdr;
  }
}

// ── Types ───────────────────────────────────────────────────────────────

export interface TransactionResult {
  success: boolean;
  hash: string;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  resultXdr?: string;
}

export interface SubmitOptions {
  /** Maximum number of submission retries for transient network errors (default 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries (default 1000). */
  baseDelayMs?: number;
  /** Polling timeout in ms after successful submission (default 30000). */
  pollTimeoutMs?: number;
  /** Polling interval in ms (default 2000). */
  pollIntervalMs?: number;
  /** Stellar network passphrase (auto-detected from Freighter if omitted). */
  networkPassphrase?: string;
}

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// ── Helpers ─────────────────────────────────────────────────────────────

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch failures
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("failed to fetch") ||
      msg.includes("network") ||
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("timeout") ||
      msg.includes("503") ||
      msg.includes("502") ||
      msg.includes("429")
    );
  }
  return false;
}

async function resolvePassphrase(override?: string): Promise<string> {
  if (override) return override;
  try {
    const name = await getCurrentNetworkName();
    return name || TESTNET_PASSPHRASE;
  } catch {
    return TESTNET_PASSPHRASE;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core API ────────────────────────────────────────────────────────────

/**
 * Submit a signed transaction to the Soroban RPC, poll for confirmation,
 * and return the result.
 *
 * Retries transient network errors with exponential backoff before giving up.
 *
 * @param signedXdr - Base64-encoded signed transaction envelope
 * @param opts      - Optional configuration overrides
 * @returns Transaction result with hash and status
 * @throws {NetworkError}            RPC unreachable after all retries
 * @throws {TimeoutError}            Transaction not confirmed in time
 * @throws {TransactionFailedError}  Transaction failed on-chain
 */
export async function submitTransaction(
  signedXdr: string,
  opts?: SubmitOptions
): Promise<TransactionResult> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const pollTimeout = opts?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollInterval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const networkPassphrase = await resolvePassphrase(opts?.networkPassphrase);
  const server = await getRpcServer();
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // ── Submit with retry ───────────────────────────────────────────────
  let sendResponse: rpc.Api.SendTransactionResponse | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      sendResponse = await server.sendTransaction(tx);
      break;
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === maxRetries) {
        throw new NetworkError(
          `Failed to submit transaction after ${attempt + 1} attempt(s): ${
            error instanceof Error ? error.message : String(error)
          }`,
          error
        );
      }
      const backoff = baseDelay * Math.pow(2, attempt);
      await delay(backoff);
    }
  }

  if (!sendResponse) {
    throw new NetworkError(
      "Failed to submit transaction: no response received",
      lastError
    );
  }

  // Immediate rejection by RPC (e.g. bad XDR, insufficient fee)
  if (sendResponse.status === "ERROR") {
    const detail =
      sendResponse.errorResult?.toXDR("base64") ?? "unknown error";
    throw new TransactionFailedError(sendResponse.hash, detail);
  }

  const txHash = sendResponse.hash;

  // ── Poll for confirmation ───────────────────────────────────────────
  const deadline = Date.now() + pollTimeout;
  let result = await server.getTransaction(txHash);

  while (
    result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() < deadline
  ) {
    await delay(pollInterval);
    try {
      result = await server.getTransaction(txHash);
    } catch {
      // Transient RPC error during polling — keep trying until timeout
    }
  }

  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      success: true,
      hash: txHash,
      status: "SUCCESS",
      resultXdr: result.resultMetaXdr?.toXDR("base64"),
    };
  }

  if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
    throw new TransactionFailedError(
      txHash,
      result.resultMetaXdr?.toXDR("base64")
    );
  }

  // Still NOT_FOUND after timeout
  throw new TimeoutError(txHash, pollTimeout);
}
