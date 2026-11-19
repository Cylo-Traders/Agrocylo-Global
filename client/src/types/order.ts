/**
 * On-chain order representation returned by the escrow contract's `get_order`.
 * Status comes from the Soroban contract enum and is left as `string` because
 * the SDK doesn't generate a tighter type for it.
 */
export interface Order {
  orderId: string;
  buyer: string;
  seller: string;
  amount: bigint;
  status: string;
  createdAt: number;
  /** Present when the indexer has surfaced the originating transaction (Issue #1015). */
  txHash?: string;
}
