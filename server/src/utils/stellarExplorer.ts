/**
 * Utility functions for generating Stellar Explorer links
 */

export type StellarNetwork = "testnet" | "mainnet";

/**
 * Get the Stellar network from environment or default to testnet
 */
export function getStellarNetwork(): StellarNetwork {
  const rpcUrl = process.env["RPC_URL"] || "";

  if (rpcUrl.includes("mainnet") || rpcUrl.includes("public")) {
    return "mainnet";
  }

  return "testnet";
}

/**
 * Generate a Stellar Expert transaction link
 * @param txHash - Transaction hash
 * @param network - Stellar network (testnet or mainnet), defaults to env-based detection
 * @returns Full URL to Stellar Expert transaction page
 */
export function getStellarExplorerTxLink(
  txHash: string,
  network?: StellarNetwork,
): string {
  const net = network || getStellarNetwork();
  const baseUrl =
    net === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";

  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Generate a Stellar Expert account link
 * @param address - Stellar account address
 * @param network - Stellar network (testnet or mainnet), defaults to env-based detection
 * @returns Full URL to Stellar Expert account page
 */
export function getStellarExplorerAccountLink(
  address: string,
  network?: StellarNetwork,
): string {
  const net = network || getStellarNetwork();
  const baseUrl =
    net === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";

  return `${baseUrl}/account/${address}`;
}
