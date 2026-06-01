/**
 * Utility functions for generating Stellar Explorer links on the frontend
 */

export type StellarNetwork = "testnet" | "mainnet";

/**
 * Detect Stellar network from RPC URL or default to testnet
 */
export function detectStellarNetwork(): StellarNetwork {
  // Check if we're in browser environment
  if (typeof window === "undefined") {
    return "testnet";
  }

  // You can add logic here to detect from wallet or config
  // For now, default to testnet
  return "testnet";
}

/**
 * Generate a Stellar Expert transaction link
 * @param txHash - Transaction hash
 * @param network - Stellar network (testnet or mainnet)
 * @returns Full URL to Stellar Expert transaction page
 */
export function getStellarExplorerTxLink(
  txHash: string,
  network: StellarNetwork = "testnet",
): string {
  const baseUrl =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";

  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Generate a Stellar Expert account link
 * @param address - Stellar account address
 * @param network - Stellar network (testnet or mainnet)
 * @returns Full URL to Stellar Expert account page
 */
export function getStellarExplorerAccountLink(
  address: string,
  network: StellarNetwork = "testnet",
): string {
  const baseUrl =
    network === "mainnet"
      ? "https://stellar.expert/explorer/public"
      : "https://stellar.expert/explorer/testnet";

  return `${baseUrl}/account/${address}`;
}

/**
 * Open Stellar Explorer transaction in new tab
 * @param txHash - Transaction hash
 * @param network - Stellar network (testnet or mainnet)
 */
export function openStellarExplorerTx(
  txHash: string,
  network: StellarNetwork = "testnet",
): void {
  const url = getStellarExplorerTxLink(txHash, network);
  window.open(url, "_blank", "noopener,noreferrer");
}
