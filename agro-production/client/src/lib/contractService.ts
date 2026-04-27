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
