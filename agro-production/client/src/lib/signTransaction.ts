import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { getWalletAdapter, DEFAULT_WALLET_ID } from "@/lib/wallets/registry";
import { loadWalletSession } from "@/lib/walletSession";
import {
  EXPECTED_NETWORK_PASSPHRASE,
  networkName,
} from "@/lib/stellarNetwork";
import {
  getInFlightForIntent,
  recordSubmittedTransaction,
  updatePendingTransaction,
} from "@/lib/pendingTransactions";

/**
 * A submitted transaction has exactly three terminal-for-now outcomes. Never
 * collapse `pending` into `failed`: the transaction is still valid until its
 * `setTimeout` bound and may be included after we stop polling.
 */
export type TransactionOutcome = "confirmed" | "failed" | "pending";

export interface SignAndSubmitResult {
  /** `true` only when the transaction is confirmed on-chain. */
  success: boolean;
  outcome: TransactionOutcome;
  txHash?: string;
  status?: string;
  error?: string;
  /** Set when the guard blocked a duplicate submission for an in-flight intent. */
  duplicate?: boolean;
}

export type TransactionSubmissionStage = "signing" | "submitting" | "confirming";

export interface SignAndSubmitOptions {
  /**
   * Stable identifier for what the user is doing (e.g. `invest:camp_42:GABC`).
   * When provided, a still-in-flight transaction for the same intent blocks a
   * second submission, and this submission is persisted for post-refresh
   * resolution.
   */
  intent?: string;
  /** Poll window in ms before returning `pending`. */
  confirmTimeoutMs?: number;
}

export class NetworkMismatchError extends Error {
  constructor(expected: string, actual: string, walletName: string) {
    super(
      `Network mismatch: expected "${networkName(expected)}" (${expected}) but ${walletName} is connected to "${networkName(actual)}" (${actual})`
    );
    this.name = "NetworkMismatchError";
  }
}

/**
 * Raised when the wallet cannot say which network it is on (#1087).
 *
 * This used to be silently replaced by the configured passphrase, which
 * treated an unreadable network as a match and let the user start a
 * transaction that could not be signed correctly. An unknown network now
 * fails closed, exactly like a mismatch.
 */
export class NetworkUnknownError extends Error {
  constructor(walletName: string) {
    super(
      `Cannot verify the wallet network: ${walletName} did not report a network passphrase. Refusing to sign until the wallet network can be confirmed.`,
    );
    this.name = "NetworkUnknownError";
  }
}

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = EXPECTED_NETWORK_PASSPHRASE;

/** Matches the `.setTimeout(30)` bound every builder applies. */
const TX_TIME_BOUND_SECONDS = 30;
const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000;

/** The wallet the user last connected with, per {@link WalletProvider}'s persisted session. */
function activeAdapter() {
  const session = loadWalletSession();
  return getWalletAdapter(session?.walletId ?? DEFAULT_WALLET_ID);
}

/**
 * The passphrase the wallet reports for its current network, or `null` when it
 * cannot be determined. Never substitutes the configured passphrase: an
 * unverifiable network must surface as unknown, not as a match (#1087).
 */
async function resolveNetworkPassphrase(
  adapter: ReturnType<typeof activeAdapter>,
): Promise<string | null> {
  try {
    const details = await adapter.getNetwork();
    return details?.networkPassphrase ?? null;
  } catch {
    return null;
  }
}

export async function signAndSubmitTransaction(
  transactionXdr: string,
  onStage?: (stage: TransactionSubmissionStage) => void,
  options: SignAndSubmitOptions = {},
): Promise<SignAndSubmitResult> {
  const { intent } = options;
  const confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;

  try {
    // Duplicate-submission guard: if a transaction for this intent is still
    // within its time bound, do not sign another one.
    if (intent) {
      const inFlight = getInFlightForIntent(intent);
      if (inFlight) {
        return {
          success: false,
          outcome: "pending",
          duplicate: true,
          txHash: inFlight.hash,
          status: "PENDING",
          error:
            "A transaction for this action is already in progress. Wait for it to resolve before trying again.",
        };
      }
    }

    const adapter = activeAdapter();
    const networkPassphrase = await resolveNetworkPassphrase(adapter);

    // Defense in depth (#1087): WalletContext already surfaces a mismatch or
    // unknown network and blocks the UI, but the signing path re-verifies so a
    // stale UI state can never sign a wrong-network transaction.
    if (!networkPassphrase) {
      throw new NetworkUnknownError(adapter.name);
    }

    if (networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new NetworkMismatchError(NETWORK_PASSPHRASE, networkPassphrase, adapter.name);
    }

    onStage?.("signing");
    const signedXdr = await adapter.signTransaction(transactionXdr, { networkPassphrase });

    if (!signedXdr) throw new Error("Transaction rejected by wallet");

    const server = new rpc.Server(RPC_URL);
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    onStage?.("submitting");
    const sendResponse = await server.sendTransaction(tx);

    if (sendResponse.status === "ERROR") {
      return {
        success: false,
        outcome: "failed",
        error: `Submission failed: ${sendResponse.status}`,
      };
    }

    const txHash = sendResponse.hash;
    if (intent) {
      recordSubmittedTransaction({
        intent,
        hash: txHash,
        timeoutSeconds: TX_TIME_BOUND_SECONDS,
      });
    }

    const deadline = Date.now() + confirmTimeoutMs;
    onStage?.("confirming");
    let result = await server.getTransaction(txHash);

    while (
      result.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 1_000));
      result = await server.getTransaction(txHash);
    }

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      if (intent) updatePendingTransaction(txHash, "confirmed");
      return { success: true, outcome: "confirmed", txHash, status: "SUCCESS" };
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      if (intent) updatePendingTransaction(txHash, "failed");
      return {
        success: false,
        outcome: "failed",
        txHash,
        status: result.status,
        error: "Transaction failed on-chain",
      };
    }

    // Still NOT_FOUND after the poll window. The transaction is valid until its
    // time bound and may yet be included — report it as pending, not failed.
    return {
      success: false,
      outcome: "pending",
      txHash,
      status: "PENDING",
      error:
        "Transaction is still pending. It has not failed — its status will resolve automatically.",
    };
  } catch (err) {
    return {
      success: false,
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
