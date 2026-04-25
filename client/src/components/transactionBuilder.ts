import * as StellarSdk from "@stellar/stellar-sdk";
import { getNetworkConfig, type NetworkConfig } from "@/services/stellar/networkConfig";

type FeeValue = string | number;

interface BaseBuilderOptions {
  sourcePublicKey: string;
  contractId?: string;
  networkPassphrase?: string;
  rpcUrl?: string;
  fee?: FeeValue;
  timeoutInSeconds?: number;
}

export interface BuildCreateOrderTransactionOptions extends BaseBuilderOptions {
  buyer: string;
  farmer: string;
  token: string;
  amount: bigint;
  deliveryDeadline?: string;
}

export interface BuildConfirmDeliveryTransactionOptions extends BaseBuilderOptions {
  buyer: string;
  orderId: string;
}

export interface BuildRefundTransactionOptions extends BaseBuilderOptions {
  caller: string;
  orderId: string;
}

export interface BuiltSorobanTransaction {
  transaction: StellarSdk.Transaction;
  xdr: string;
  fee: string;
  networkPassphrase: string;
  simulation: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
}

interface ResolvedBuilderConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  fee: string;
  timeoutInSeconds: number;
}

function resolveBuilderConfig(options: BaseBuilderOptions): ResolvedBuilderConfig {
  const defaults: NetworkConfig = getNetworkConfig();
  const contractId = options.contractId ?? defaults.contractId;

  if (!contractId) {
    throw new Error(
      "Contract ID is not configured. Pass contractId or set NEXT_PUBLIC_CONTRACT_ID."
    );
  }

  return {
    contractId,
    rpcUrl: options.rpcUrl ?? defaults.rpcUrl,
    networkPassphrase:
      options.networkPassphrase ?? defaults.networkPassphrase,
    fee: String(options.fee ?? StellarSdk.BASE_FEE),
    timeoutInSeconds: options.timeoutInSeconds ?? 30,
  };
}

async function buildContractTransaction(
  options: BaseBuilderOptions,
  method: string,
  args: StellarSdk.xdr.ScVal[],
  memo?: StellarSdk.Memo
): Promise<BuiltSorobanTransaction> {
  const config = resolveBuilderConfig(options);
  const server = new StellarSdk.rpc.Server(config.rpcUrl);
  const sourceAccount = await server.getAccount(options.sourcePublicKey);
  const contract = new StellarSdk.Contract(config.contractId);

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: config.fee,
    networkPassphrase: config.networkPassphrase,
  }).addOperation(contract.call(method, ...args));

  if (memo) {
    builder.addMemo(memo);
  }

  const transaction = builder.setTimeout(config.timeoutInSeconds).build();
  const simulated = await server.simulateTransaction(transaction);

  if (StellarSdk.rpc.Api.isSimulationError(simulated)) {
    throw new Error(
      `Simulation failed: ${
        (simulated as StellarSdk.rpc.Api.SimulateTransactionErrorResponse).error
      }`
    );
  }

  const prepared = StellarSdk.rpc.assembleTransaction(
    transaction,
    simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse
  ).build();

  return {
    transaction: prepared,
    xdr: prepared.toXDR(),
    fee: prepared.fee,
    networkPassphrase: config.networkPassphrase,
    simulation:
      simulated as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  };
}

export async function buildCreateOrderTransaction(
  options: BuildCreateOrderTransactionOptions
): Promise<BuiltSorobanTransaction> {
  const memo =
    options.deliveryDeadline && options.deliveryDeadline.trim().length > 0
      ? StellarSdk.Memo.text(
          `DELIVERY_DEADLINE:${options.deliveryDeadline}`
        )
      : undefined;

  return buildContractTransaction(
    options,
    "create_order",
    [
      new StellarSdk.Address(options.buyer).toScVal(),
      new StellarSdk.Address(options.farmer).toScVal(),
      new StellarSdk.Address(options.token).toScVal(),
      StellarSdk.nativeToScVal(options.amount, { type: "i128" }),
    ],
    memo
  );
}

export async function buildConfirmDeliveryTransaction(
  options: BuildConfirmDeliveryTransactionOptions
): Promise<BuiltSorobanTransaction> {
  return buildContractTransaction(options, "confirm_delivery", [
    new StellarSdk.Address(options.buyer).toScVal(),
    StellarSdk.nativeToScVal(options.orderId, { type: "symbol" }),
  ]);
}

export async function buildRefundTransaction(
  options: BuildRefundTransactionOptions
): Promise<BuiltSorobanTransaction> {
  return buildContractTransaction(options, "refund_order", [
    new StellarSdk.Address(options.caller).toScVal(),
    StellarSdk.nativeToScVal(options.orderId, { type: "symbol" }),
  ]);
}
