/**
 * Stellar / Soroban network configuration.
 *
 * Reads the active network from environment variables so the same code
 * works against a local standalone instance, the public testnet, or
 * mainnet without any code changes.
 *
 * Environment variables (set in `.env.local`):
 *   NEXT_PUBLIC_SOROBAN_RPC_URL   - Soroban RPC endpoint
 *   NEXT_PUBLIC_NETWORK_PASSPHRASE - Stellar network passphrase
 *   NEXT_PUBLIC_CONTRACT_ID        - Deployed escrow contract address
 */

export interface NetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}

/** Currency → token contract ID map, validated once at module load. */
export const TOKEN_CONTRACT_IDS: Record<string, string> = {
  STRK: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID_STRK ?? "",
  USDC: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID_USDC ?? "",
};

/**
 * Validates that a token contract ID is configured for the given currency.
 * Throws a user-readable error naming the missing env var before any signing starts.
 */
export function requireTokenContractId(currency: string): string {
  const id = TOKEN_CONTRACT_IDS[currency.toUpperCase()];
  if (!id) {
    throw new Error(
      `Token contract ID for ${currency} is not configured. ` +
        `Set NEXT_PUBLIC_TOKEN_CONTRACT_ID_${currency.toUpperCase()} in your environment.`,
    );
  }
  return id;
}

const TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * Returns the active network configuration.
 *
 * Falls back to Stellar Testnet defaults when env vars are not set,
 * which is the expected development environment for Agrocylo.
 */
export function getNetworkConfig(): NetworkConfig {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? TESTNET_RPC_URL;

  const networkPassphrase =
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE;

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
  if (!contractId) {
    console.warn(
      "[networkConfig] NEXT_PUBLIC_CONTRACT_ID is not set. " +
        "Contract calls will fail until a deployed contract address is provided."
    );
  }

  return { rpcUrl, networkPassphrase, contractId };
}
