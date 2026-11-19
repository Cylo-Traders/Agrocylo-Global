import { rpc } from "@stellar/stellar-sdk";

/** Create the Soroban RPC server used by contract transaction builders. */
export function createSorobanRpcServer(rpcUrl: string): rpc.Server {
  return new rpc.Server(rpcUrl);
}
