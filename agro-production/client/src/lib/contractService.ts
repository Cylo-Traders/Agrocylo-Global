/**
 * Production-Escrow contract interaction.
 *
 * Builds unsigned transactions for the agro-production escrow contract
 * (NEXT_PUBLIC_PRODUCTION_CONTRACT_ID) and returns the XDR string ready
 * for wallet signing.
 *
 * Every builder derives its inclusion fee from live network conditions
 * (see `feeStrategy.ts`) instead of hard-coding `BASE_FEE`, and shares a
 * single simulate → assemble pipeline so new contract entry points stay a
 * one-line addition rather than a copy-paste of the whole flow.
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import { estimateInclusionFee } from "./feeStrategy";
import { createSorobanRpcServer } from "./rpcClient";
import { assembleSorobanTransaction } from "./transactionAssembler";

const rpcUrl = () =>
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

/** Time bound applied to every built transaction, in seconds. */
export const TX_TIMEOUT_SECONDS = 30;

export interface ContractResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function server(): StellarSdk.rpc.Server {
  return createSorobanRpcServer(rpcUrl());
}

function contract(): StellarSdk.Contract {
  // Read lazily: the env var may be injected after module load (tests, SSR).
  const contractId = process.env.NEXT_PUBLIC_PRODUCTION_CONTRACT_ID ?? "";
  if (!contractId) {
    throw new Error(
      "NEXT_PUBLIC_PRODUCTION_CONTRACT_ID is not set. Configure it with your deployed production-escrow contract address.",
    );
  }
  return new StellarSdk.Contract(contractId);
}

// --- ScVal argument helpers -------------------------------------------------

export const addr = (a: string) => new StellarSdk.Address(a).toScVal();
export const u64 = (v: string | number | bigint) =>
  StellarSdk.nativeToScVal(BigInt(v), { type: "u64" });
export const u32 = (v: number) => StellarSdk.nativeToScVal(v, { type: "u32" });
export const i128 = (v: bigint) => StellarSdk.nativeToScVal(v, { type: "i128" });
export const addrVec = (addrs: string[]) =>
  StellarSdk.xdr.ScVal.scvVec(
    addrs.map((a) => new StellarSdk.Address(a).toScVal()),
  );

/** `DisputeResolution` enum from the contract spec. */
export type DisputeResolution =
  | { tag: "FullPayoutToInvestors" }
  | { tag: "RefundInvestors" }
  | { tag: "Partial"; farmerBps: number };

export function disputeResolutionScVal(r: DisputeResolution): StellarSdk.xdr.ScVal {
  if (r.tag === "Partial") {
    return StellarSdk.xdr.ScVal.scvVec([
      StellarSdk.xdr.ScVal.scvSymbol("Partial"),
      StellarSdk.nativeToScVal(r.farmerBps, { type: "u32" }),
    ]);
  }
  return StellarSdk.xdr.ScVal.scvVec([StellarSdk.xdr.ScVal.scvSymbol(r.tag)]);
}

// --- Shared build pipeline -------------------------------------------------

/**
 * Build, simulate and assemble a single-invocation contract transaction.
 *
 * The inclusion fee is taken from `getFeeStats` at the configured percentile;
 * `assembleTransaction` then adds the simulated Soroban resource fee on top.
 */
export async function buildContractTx(
  source: string,
  method: string,
  buildArgs: () => StellarSdk.xdr.ScVal[],
): Promise<ContractResult<string>> {
  try {
    // ScVal construction (address strkey parsing, i128 range) is done here so a
    // bad argument returns a graceful error instead of throwing synchronously.
    const args = buildArgs();
    const rpcServer = server();
    const escrow = contract();
    const sourceAccount = await rpcServer.getAccount(source);
    const { inclusionFee } = await estimateInclusionFee(rpcServer);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: inclusionFee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(escrow.call(method, ...args))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    const simulated = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      throw new Error(
        `Simulation failed: ${(simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }

    const prepared = assembleSorobanTransaction(
      tx,
      simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
    ).build();

    return { success: true, data: prepared.toXDR() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// --- Campaign lifecycle: funding ----------------------------------------------

/**
 * Build a `create_campaign` transaction.
 *
 * @param farmer       - Stellar public key of the farmer
 * @param tokenAddress - Token contract address
 * @param targetAmount - Target funding amount in base units (i128)
 * @param deadline     - Deadline timestamp in seconds (u64)
 */
export function buildCreateCampaign(
  farmer: string,
  tokenAddress: string,
  targetAmount: bigint,
  deadline: number,
): Promise<ContractResult<string>> {
  return buildContractTx(farmer, "create_campaign", () => [
    addr(farmer),
    addr(tokenAddress),
    i128(targetAmount),
    u64(deadline),
  ]);
}

/**
 * Build an `invest` transaction. `amount` is always base units (stroops for
 * XLM), never a JavaScript floating-point value.
 */
export function buildInvest(
  investor: string,
  campaignId: string,
  amount: bigint,
): Promise<ContractResult<string>> {
  return buildContractTx(investor, "invest", () => [
    addr(investor),
    u64(campaignId),
    i128(amount),
  ]);
}

// --- Campaign lifecycle: farmer progression ---------------------------------

/** Farmer starts production once a campaign is funded (releases the start tranche). */
export function buildStartProduction(
  farmer: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(farmer, "start_production", () => [addr(farmer), u64(campaignId)]);
}

/** Farmer marks harvest done; requires an independent attester co-signature. */
export function buildMarkHarvest(
  farmer: string,
  attesterCaller: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(farmer, "mark_harvest", () => [
    addr(farmer),
    addr(attesterCaller),
    u64(campaignId),
  ]);
}

/** Buyer or oracle advances to the next milestone; requires an attester co-signature. */
export function buildAdvanceMilestone(
  caller: string,
  attesterCaller: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(caller, "advance_milestone", () => [
    addr(caller),
    addr(attesterCaller),
    u64(campaignId),
  ]);
}

/** Farmer or admin settles a harvested campaign so investors can claim returns. */
export function buildSettle(
  caller: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(caller, "settle", () => [addr(caller), u64(campaignId)]);
}

/** Farmer or admin marks a campaign failed, opening the refund path for investors. */
export function buildMarkCampaignFailed(
  caller: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(caller, "mark_campaign_failed", () => [addr(caller), u64(campaignId)]);
}

// --- Investor fund-safety paths -------------------------------------------------

/** Investor claims their proportional share of remaining escrow after settlement. */
export function buildClaimReturns(
  investor: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(investor, "claim_returns", () => [addr(investor), u64(campaignId)]);
}

/** Investor reclaims their contribution on a failed campaign. */
export function buildRefund(
  investor: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(investor, "refund", () => [addr(investor), u64(campaignId)]);
}

/** Admin batch-refunds up to 50 investors on a failed campaign. */
export function buildBatchRefundInvestors(
  caller: string,
  campaignId: string,
  investors: string[],
): Promise<ContractResult<string>> {
  return buildContractTx(caller, "batch_refund_investors", () => [
    u64(campaignId),
    addrVec(investors),
  ]);
}

/** Investor transfers their whole position in a non-terminal campaign to another address. */
export function buildTransferInvestment(
  from: string,
  to: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(from, "transfer_investment", () => [
    addr(from),
    addr(to),
    u64(campaignId),
  ]);
}

// --- Dispute flows -----------------------------------------------------------

/** Farmer, admin or any investor opens a dispute on a campaign. */
export function buildOpenDispute(
  caller: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(caller, "open_dispute", () => [addr(caller), u64(campaignId)]);
}

/** Admin resolves a dispute with the chosen `DisputeResolution`. */
export function buildResolveDispute(
  adminCaller: string,
  campaignId: string,
  resolution: DisputeResolution,
): Promise<ContractResult<string>> {
  return buildContractTx(adminCaller, "resolve_dispute", () => [
    addr(adminCaller),
    u64(campaignId),
    disputeResolutionScVal(resolution),
  ]);
}

/** Configured arbitrator casts a vote toward resolving a disputed campaign. */
export function buildVoteToResolve(
  arbitrator: string,
  campaignId: string,
  resolution: DisputeResolution,
): Promise<ContractResult<string>> {
  return buildContractTx(arbitrator, "vote_to_resolve", () => [
    addr(arbitrator),
    u64(campaignId),
    disputeResolutionScVal(resolution),
  ]);
}

// --- Orders -----------------------------------------------------------------

/**
 * Build a `create_order` transaction.
 *
 * @param buyer      - Stellar public key of the buyer
 * @param campaignId - On-chain campaign ID (u64 as string)
 * @param amount     - Token amount in base units (i128)
 */
export function buildCreateOrder(
  buyer: string,
  campaignId: string,
  amount: bigint,
): Promise<ContractResult<string>> {
  return buildContractTx(buyer, "create_order", () => [
    addr(buyer),
    u64(campaignId),
    i128(amount),
  ]);
}

/** Buyer confirms receipt of an order, releasing its funds. */
export function buildConfirmOrder(
  buyer: string,
  orderId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(buyer, "confirm_order", () => [addr(buyer), u64(orderId)]);
}

/** Buyer cancels a pending order and is refunded. */
export function buildCancelOrder(
  buyer: string,
  orderId: string,
): Promise<ContractResult<string>> {
  return buildContractTx(buyer, "cancel_order", () => [addr(buyer), u64(orderId)]);
}
