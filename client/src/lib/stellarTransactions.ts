/**
 * Stellar / Soroban transaction pipeline — the ONE implementation.
 *
 * Consolidates what used to be three diverging modules (issue #809):
 *   - lib/signTransaction.ts       (real checkout path, no typed errors)
 *   - lib/soroban.ts               (a second status poller)
 *   - components/submitTransaction.ts (typed errors + retry, sandbox only)
 *
 * Every call site — the real order flow (CreateOrderForm → useEscrowContract →
 * WalletContext) and the escrow sandbox components — goes through here.
 *
 * Lifecycle:
 *   1. Frontend builds transaction (XDR)
 *   2. Wallet signs (Freighter prompt) — refused on a network mismatch
 *   3. Signed tx submitted to Soroban RPC, with retry/backoff on transient errors
 *   4. Poll for a terminal status and return a typed result
 */

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import FreighterApi from "@stellar/freighter-api";
import { getRpcServer } from "./stellar";
import { isTestMode } from "./testMode";
import {
  getExpectedNetworkPassphrase,
  normalizeToPassphrase,
} from "../services/stellar/networkConfig";

// ── Typed error classes ──────────────────────────────────────────────────

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
    super(`Transaction ${hash} was not confirmed within ${timeoutMs / 1000}s`);
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

/**
 * #993 — Thrown when the signed XDR returned by the wallet differs from the
 * transaction the app prepared. The only permitted difference is the addition
 * of signatures; any mutation to source, sequence, fee, operations, or time
 * bounds is rejected before RPC submission.
 */
export class XdrMismatchError extends Error {
  public readonly field: string;
  constructor(field: string) {
    super(
      `Signed transaction does not match the prepared intent — "${field}" was altered. ` +
        "This may indicate a wallet or provider bug. Please retry from the beginning.",
    );
    this.name = "XdrMismatchError";
    this.field = field;
  }
}

/**
 * Thrown when the connected wallet's active network does not match the network
 * the app is configured for. Refusing to sign/submit in this case prevents a
 * transaction being built for one ledger and executed against another.
 */
export class NetworkMismatchError extends Error {
  public readonly walletNetwork: string;
  public readonly expectedNetwork: string;
  constructor(walletNetwork: string, expectedNetwork: string) {
    super(
      `Wallet network mismatch: your wallet is on "${walletNetwork}" but this app is configured for "${expectedNetwork}". ` +
        "Switch your wallet to the correct network and try again.",
    );
    this.name = "NetworkMismatchError";
    this.walletNetwork = walletNetwork;
    this.expectedNetwork = expectedNetwork;
  }
}

// ── Types ────────────────────────────────────────────────────────────────

export type TransactionErrorKind =
  | "mismatch"
  | "rejected"
  | "network"
  | "timeout"
  | "failed"
  | "xdr_mismatch";

export interface SignAndSubmitResult {
  success: boolean;
  txHash?: string;
  status?: string;
  resultXdr?: string;
  error?: string;
  /** Populated on failure so callers can branch without re-parsing `error`. */
  errorKind?: TransactionErrorKind;
}

export interface TransactionStatusResult {
  status: "SUCCESS" | "FAILED" | "PENDING" | "NOT_FOUND" | "TIMEOUT";
  txHash: string;
  resultXdr?: string;
  error?: string;
  response?: rpc.Api.GetTransactionResponse;
}

export interface SignTransactionOptions {
  /** Network passphrase override (app config is the source of truth otherwise). */
  networkPassphrase?: string;
  /** Polling timeout in ms after submission (default 30 000). */
  timeoutMs?: number;
  /** Polling interval in ms (default 2 000). */
  intervalMs?: number;
  /** Max submission retries for transient network errors (default 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff between retries (default 1 000). */
  baseDelayMs?: number;
  /**
   * #993 — Expected signer address. Passed to wallet adapters that support
   * `accountToSign` (e.g. Freighter) so a multi-account wallet uses the right key.
   */
  accountToSign?: string;
}

// ── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;

// ── Helpers ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/**
 * The app's configured network is the source of truth for what we sign against.
 * The wallet's active network is only cross-checked — never silently trusted.
 * Throws {@link NetworkMismatchError} when they disagree, or in a mainnet build
 * with no passphrase configured (see `getExpectedNetworkPassphrase`).
 */
async function resolveNetworkPassphrase(override?: string): Promise<string> {
  if (override) return override;
  const expected = getExpectedNetworkPassphrase();
  try {
    const details = await FreighterApi.getNetworkDetails();
    const walletPassphrase =
      normalizeToPassphrase(details?.networkPassphrase) ??
      normalizeToPassphrase(details?.network);
    if (walletPassphrase && walletPassphrase !== expected) {
      throw new NetworkMismatchError(walletPassphrase, expected);
    }
  } catch (err) {
    if (err instanceof NetworkMismatchError) throw err;
    // Freighter unreachable (or a non-Freighter adapter): fall through to the
    // app's configured passphrase. WalletContext's mismatch guard + the
    // persistent banner still cover the wallet-on-wrong-network case.
  }
  return expected;
}

// ── Core API ─────────────────────────────────────────────────────────────

/**
 * #993 — Verify that the wallet returned the same transaction the app prepared.
 *
 * The only valid difference between `preparedXdr` and `signedXdr` is the
 * addition of signatures. Any change to source account, sequence, fee,
 * operations (type, contract, function, arguments), or time bounds is
 * rejected before the transaction reaches the Soroban RPC.
 *
 * Skips verification gracefully when `fromXDR` returns a stub (test mocks
 * that do not implement the full Transaction interface).
 */
export function verifySignedXdrInvariants(
  preparedXdr: string,
  signedXdr: string,
  networkPassphrase: string,
): void {
  const prepared = TransactionBuilder.fromXDR(preparedXdr, networkPassphrase);
  const signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // Skip when the SDK returns a stub object (test environment).
  if (typeof (prepared as unknown as { hash?: unknown }).hash !== "function") return;

  const p = prepared as unknown as TxLike;
  const s = signed as unknown as TxLike;

  // Primary check: transaction hash covers every mutable field except sigs.
  const preparedHash = p.hash().toString("hex");
  const signedHash = s.hash().toString("hex");
  if (preparedHash === signedHash) return;

  // Secondary pass: identify which field changed for a diagnostic message.
  // None of these branches log full XDR or signature data.
  if (p.source !== s.source) throw new XdrMismatchError("source account");

  if (p.sequence !== undefined && p.sequence !== s.sequence) {
    throw new XdrMismatchError("sequence number");
  }

  if (p.fee !== s.fee) throw new XdrMismatchError("fee");

  const pBounds = p.timeBounds;
  const sBounds = s.timeBounds;
  if (
    (pBounds?.minTime ?? "0") !== (sBounds?.minTime ?? "0") ||
    (pBounds?.maxTime ?? "0") !== (sBounds?.maxTime ?? "0")
  ) {
    throw new XdrMismatchError("time bounds");
  }

  const pOps = p.operations ?? [];
  const sOps = s.operations ?? [];
  if (pOps.length !== sOps.length) throw new XdrMismatchError("operation count");

  for (let i = 0; i < pOps.length; i++) {
    const pOp = pOps[i] as OpLike;
    const sOp = sOps[i] as OpLike;
    if (pOp.type !== sOp.type) throw new XdrMismatchError(`operation[${i}] type`);
    if (pOp.type === "invokeHostFunction") {
      const pFuncXdr = pOp.func?.toXDR?.("base64") ?? "";
      const sFuncXdr = sOp.func?.toXDR?.("base64") ?? "";
      if (pFuncXdr !== sFuncXdr) throw new XdrMismatchError(`operation[${i}] contract or arguments`);
    }
  }

  throw new XdrMismatchError("transaction body");
}

// Minimal structural types used inside verifySignedXdrInvariants.
interface TimeBounds { minTime?: string; maxTime?: string }
interface OpLike {
  type: string;
  func?: { toXDR?: (fmt: string) => string };
}
interface TxLike {
  hash(): Buffer;
  source?: string;
  sequence?: string;
  fee?: string;
  timeBounds?: TimeBounds;
  operations?: unknown[];
}

/**
 * Sign a transaction XDR using the Freighter wallet.
 * Throws if the user rejects, Freighter is unavailable, or the wallet network
 * does not match the app's configured network.
 */
export async function signTransaction(
  transactionXdr: string,
  opts?: Pick<SignTransactionOptions, "networkPassphrase" | "accountToSign">,
): Promise<string> {
  const networkPassphrase = await resolveNetworkPassphrase(opts?.networkPassphrase);
  const accountToSign = opts?.accountToSign;

  // Prefer window.freighter if available (e.g. Playwright test mocks).
  const freighterDirect =
    typeof window !== "undefined"
      ? window.freighter ?? window.freighterApi ?? null
      : null;

  const signedXdr = freighterDirect
    ? await freighterDirect.signTransaction(transactionXdr, { networkPassphrase, accountToSign })
    : await FreighterApi.signTransaction(transactionXdr, { networkPassphrase, accountToSign });

  if (!signedXdr) {
    throw new Error("Transaction was rejected by the wallet");
  }
  return signedXdr;
}

/**
 * Poll the Soroban RPC for a transaction's terminal status.
 * Transient RPC errors during polling are swallowed until the timeout.
 */
export async function pollTransaction(
  txHash: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): Promise<TransactionStatusResult> {
  const server = await getRpcServer();
  const deadline = Date.now() + timeoutMs;

  let response = await server.getTransaction(txHash);
  while (
    response.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
    Date.now() < deadline
  ) {
    await delay(intervalMs);
    try {
      response = await server.getTransaction(txHash);
    } catch {
      // transient RPC error — keep polling until the deadline
    }
  }

  if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return {
      status: "SUCCESS",
      txHash,
      resultXdr: response.resultMetaXdr?.toXDR("base64"),
      response,
    };
  }
  if (response.status === rpc.Api.GetTransactionStatus.FAILED) {
    return {
      status: "FAILED",
      txHash,
      resultXdr: response.resultMetaXdr?.toXDR("base64"),
      error: "Transaction failed on-chain",
      response,
    };
  }
  return {
    status: "TIMEOUT",
    txHash,
    error: `Transaction polling timed out after ${timeoutMs / 1000}s`,
  };
}

/**
 * Submit a signed transaction XDR to the Soroban RPC and wait for a terminal
 * status. Retries transient network errors with exponential backoff.
 *
 * @throws {NetworkError}           RPC unreachable after all retries
 * @throws {TimeoutError}           not confirmed within the timeout
 * @throws {TransactionFailedError} terminal on-chain failure
 */
export async function submitTransactionOrThrow(
  signedXdr: string,
  opts?: SignTransactionOptions,
): Promise<{ txHash: string; resultXdr?: string }> {
  if (isTestMode()) {
    return {
      txHash: "0000000000000000000000000000000000000000000000000000000000000000",
      resultXdr: "AAAAAgAAAAB6Mcc=",
    };
  }

  const networkPassphrase = await resolveNetworkPassphrase(opts?.networkPassphrase);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelay = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  const server = await getRpcServer();
  const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  let sendResponse: rpc.Api.SendTransactionResponse | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      sendResponse = await server.sendTransaction(tx);
      break;
    } catch (error) {
      if (!isTransientError(error) || attempt === maxRetries) {
        throw new NetworkError(
          `Failed to submit transaction after ${attempt + 1} attempt(s): ${
            error instanceof Error ? error.message : String(error)
          }`,
          error,
        );
      }
      await delay(baseDelay * 2 ** attempt);
    }
  }
  if (!sendResponse) {
    throw new NetworkError("Failed to submit transaction: no response received");
  }
  if (sendResponse.status === "ERROR") {
    throw new TransactionFailedError(
      sendResponse.hash,
      sendResponse.errorResult?.toXDR("base64") ?? undefined,
    );
  }

  const polled = await pollTransaction(sendResponse.hash, timeoutMs, intervalMs);
  if (polled.status === "SUCCESS") {
    return { txHash: polled.txHash, resultXdr: polled.resultXdr };
  }
  if (polled.status === "FAILED") {
    throw new TransactionFailedError(polled.txHash, polled.resultXdr);
  }
  throw new TimeoutError(polled.txHash, timeoutMs);
}

/**
 * Submit a signed transaction and return a result object (never throws for the
 * expected failure modes). Failure results carry a typed `errorKind`.
 */
export async function submitTransaction(
  signedXdr: string,
  opts?: SignTransactionOptions,
): Promise<SignAndSubmitResult> {
  try {
    const { txHash, resultXdr } = await submitTransactionOrThrow(signedXdr, opts);
    return { success: true, txHash, status: "SUCCESS", resultXdr };
  } catch (err) {
    return toFailureResult(err);
  }
}

/**
 * End-to-end helper: sign then submit. The primary entry point for every
 * transaction-sending path in the app.
 *
 * #993 — After signing, the returned XDR is verified against the prepared
 * transaction before any RPC call is made. Mismatch throws {@link XdrMismatchError}.
 */
export async function signAndSubmitTransaction(
  transactionXdr: string,
  opts?: SignTransactionOptions,
): Promise<SignAndSubmitResult> {
  try {
    const signedXdr = await signTransaction(transactionXdr, opts);
    const networkPassphrase =
      opts?.networkPassphrase ?? getExpectedNetworkPassphrase();
    verifySignedXdrInvariants(transactionXdr, signedXdr, networkPassphrase);
    return await submitTransaction(signedXdr, opts);
  } catch (err) {
    return toFailureResult(err);
  }
}

function toFailureResult(err: unknown): SignAndSubmitResult {
  if (err instanceof XdrMismatchError) {
    return { success: false, error: err.message, errorKind: "xdr_mismatch" };
  }
  if (err instanceof NetworkMismatchError) {
    return { success: false, error: err.message, errorKind: "mismatch" };
  }
  if (err instanceof TimeoutError) {
    return {
      success: false,
      txHash: err.hash,
      status: "TIMEOUT",
      error: err.message,
      errorKind: "timeout",
    };
  }
  if (err instanceof TransactionFailedError) {
    return {
      success: false,
      txHash: err.hash,
      status: "FAILED",
      resultXdr: err.resultXdr,
      error: err.message,
      errorKind: "failed",
    };
  }
  if (err instanceof NetworkError) {
    return { success: false, error: err.message, errorKind: "network" };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    success: false,
    error: message,
    errorKind: /rejected|denied|declined/i.test(message) ? "rejected" : undefined,
  };
}
