/**
 * Production-Escrow contract interaction.
 *
 * Builds unsigned transactions for the agro-production escrow contract
 * (NEXT_PUBLIC_PRODUCTION_CONTRACT_ID) and returns the XDR string ready
 * for wallet signing.
 */

import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID = process.env.NEXT_PUBLIC_PRODUCTION_CONTRACT_ID ?? "";

export interface ContractResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function server(): StellarSdk.rpc.Server {
  return new StellarSdk.rpc.Server(RPC_URL);
}

function contract(): StellarSdk.Contract {
  if (!CONTRACT_ID) {
    throw new Error(
      "NEXT_PUBLIC_PRODUCTION_CONTRACT_ID is not set. Configure it with your deployed production-escrow contract address.",
    );
  }
  return new StellarSdk.Contract(CONTRACT_ID);
}

/**
 * Build a `create_campaign` transaction for the production-escrow contract.
 *
 * @param farmer       - Stellar public key of the farmer
 * @param tokenAddress - Token contract address
 * @param targetAmount - Target funding amount in base units (i128)
 * @param deadline     - Deadline timestamp in seconds (u64)
 */
export async function buildCreateCampaign(
  farmer: string,
  tokenAddress: string,
  targetAmount: bigint,
  deadline: number,
): Promise<ContractResult<string>> {
  try {
    const rpcServer = server();
    const escrow = contract();
    const sourceAccount = await rpcServer.getAccount(farmer);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        escrow.call(
          "create_campaign",
          new StellarSdk.Address(farmer).toScVal(),
          new StellarSdk.Address(tokenAddress).toScVal(),
          StellarSdk.nativeToScVal(targetAmount, { type: "i128" }),
          StellarSdk.nativeToScVal(BigInt(deadline), { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulated = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      throw new Error(
        `Simulation failed: ${(simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }

    const prepared = StellarSdk.rpc
      .assembleTransaction(tx, simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
      .build();

    return { success: true, data: prepared.toXDR() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build a `create_order` transaction for the production-escrow contract.
 *
 * @param buyer      - Stellar public key of the buyer
 * @param campaignId - On-chain campaign ID (u64 as string)
 * @param amount     - Token amount in base units (i128)
 */
export async function buildCreateOrder(
  buyer: string,
  campaignId: string,
  amount: bigint,
): Promise<ContractResult<string>> {
  try {
    const rpcServer = server();
    const escrow = contract();

    const sourceAccount = await rpcServer.getAccount(buyer);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        escrow.call(
          "create_order",
          new StellarSdk.Address(buyer).toScVal(),
          StellarSdk.nativeToScVal(BigInt(campaignId), { type: "u64" }),
          StellarSdk.nativeToScVal(amount, { type: "i128" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulated = await rpcServer.simulateTransaction(tx);

    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      throw new Error(
        `Simulation failed: ${(simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }

    const prepared = StellarSdk.rpc
      .assembleTransaction(tx, simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
      .build();

    return { success: true, data: prepared.toXDR() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build an `invest` transaction for the production-escrow contract.
 *
 * The contract requires the investor address as the authenticated source and
 * the campaign's on-chain u64 ID. `amount` is always expressed in base units
 * (stroops for XLM), never a JavaScript floating-point value.
 */
export async function buildInvest(
  investor: string,
  campaignId: string,
  amount: bigint,
): Promise<ContractResult<string>> {
  try {
    const rpcServer = server();
    const escrow = contract();
    const sourceAccount = await rpcServer.getAccount(investor);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        escrow.call(
          "invest",
          new StellarSdk.Address(investor).toScVal(),
          StellarSdk.nativeToScVal(BigInt(campaignId), { type: "u64" }),
          StellarSdk.nativeToScVal(amount, { type: "i128" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulated = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      throw new Error(
        `Simulation failed: ${(simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }

    const prepared = StellarSdk.rpc
      .assembleTransaction(tx, simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
      .build();

    return { success: true, data: prepared.toXDR() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build a `claim_returns` transaction for the production-escrow contract.
 *
 * The investor claims their proportional share of remaining escrow after settlement.
 */
export async function buildClaimReturns(
  investor: string,
  campaignId: string,
): Promise<ContractResult<string>> {
  try {
    const rpcServer = server();
    const escrow = contract();
    const sourceAccount = await rpcServer.getAccount(investor);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        escrow.call(
          "claim_returns",
          new StellarSdk.Address(investor).toScVal(),
          StellarSdk.nativeToScVal(BigInt(campaignId), { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulated = await rpcServer.simulateTransaction(tx);
    if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
      throw new Error(
        `Simulation failed: ${(simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error}`,
      );
    }

    const prepared = StellarSdk.rpc
      .assembleTransaction(tx, simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse)
      .build();

    return { success: true, data: prepared.toXDR() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
