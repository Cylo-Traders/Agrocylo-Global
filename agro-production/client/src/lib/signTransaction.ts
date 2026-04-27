import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import FreighterApi from "@stellar/freighter-api";

export interface SignAndSubmitResult {
  success: boolean;
  txHash?: string;
  status?: string;
  error?: string;
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
): Promise<SignAndSubmitResult> {
  try {
    const networkPassphrase = await resolveNetworkPassphrase();

    const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : null;
    const freighterDirect =
      (w?.freighter as { signTransaction?: unknown } | undefined)?.signTransaction
        ? (w!.freighter as { signTransaction: (xdr: string, opts: { networkPassphrase: string }) => Promise<string> })
        : (w?.freighterApi as { signTransaction?: unknown } | undefined)?.signTransaction
        ? (w!.freighterApi as { signTransaction: (xdr: string, opts: { networkPassphrase: string }) => Promise<string> })
        : null;

    const signedXdr = freighterDirect
      ? await freighterDirect.signTransaction(transactionXdr, { networkPassphrase })
      : await FreighterApi.signTransaction(transactionXdr, { networkPassphrase });

    if (!signedXdr) throw new Error("Transaction rejected by wallet");

    const server = new rpc.Server(RPC_URL);
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    const sendResponse = await server.sendTransaction(tx);

    if (sendResponse.status === "ERROR") {
      return { success: false, error: `Submission failed: ${sendResponse.status}` };
    }

    const txHash = sendResponse.hash;
    const deadline = Date.now() + 30_000;
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
