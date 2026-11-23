import { rpc } from "@stellar/stellar-sdk";
import { resolvePendingTransactions } from "@/lib/pendingTransactions";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

export async function reconcilePendingTransactions() {
  const server = new rpc.Server(RPC_URL);
  return resolvePendingTransactions({
    getTransaction: (hash) => server.getTransaction(hash),
  });
}
