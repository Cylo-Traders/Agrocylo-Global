import { rpc } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";

/** Keep Soroban assembly behind a small boundary for deterministic builder tests. */
export function assembleSorobanTransaction(
  transaction: Transaction,
  simulation: Parameters<typeof rpc.assembleTransaction>[1],
) {
  return rpc.assembleTransaction(transaction, simulation);
}
