import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import FreighterApi from "@stellar/freighter-api";
import { getFreighterSignerFromWindow } from "@/types/freighter";

export interface SignAndSubmitResult {
  success: boolean;
  txHash?: string;
  status?: string;
  error?: string;
}

export type TransactionSubmissionStage = "signing" | "submitting" | "confirming";

export class NetworkMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `Network mismatch: expected "${expected}" but Freighter is connected to "${actual}"`
    );
    this.name = "NetworkMismatchError";
  }
}

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

async function resolveNetworkPassphrase(): Promise<string> {
  try {
    const details = await FreighterApi.getNetworkDetails();
    return details.networkPassphrase;
  } catch {
    return NETWORK_PASSPHRASE;
  }
}

export async function signAndSubmitTransaction(
  transactionXdr: string,
  onStage?: (stage: TransactionSubmissionStage) => void,
): Promise<SignAndSubmitResult> {
  try {
    const networkPassphrase = await resolveNetworkPassphrase();

    if (networkPassphrase !== NETWORK_PASSPHRASE) {
      throw new NetworkMismatchError(NETWORK_PASSPHRASE, networkPassphrase);
    }

    onStage?.("signing");
    const signer = getFreighterSignerFromWindow();
    const signedXdr = signer
      ? await signer.signTransaction(transactionXdr, { networkPassphrase })
      : await FreighterApi.signTransaction(transactionXdr, { networkPassphrase });

    if (!signedXdr) throw new Error("Transaction rejected by wallet");

    const server = new rpc.Server(RPC_URL);
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    onStage?.("submitting");
    const sendResponse = await server.sendTransaction(tx);

    if (sendResponse.status === "ERROR") {
      return { success: false, error: `Submission failed: ${sendResponse.status}` };
    }

    const txHash = sendResponse.hash;
    const deadline = Date.now() + 30_000;
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
      return { success: true, txHash, status: "SUCCESS" };
    }

    return {
      success: false,
      txHash,
      status: result.status,
      error: "Transaction failed on-chain",
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
