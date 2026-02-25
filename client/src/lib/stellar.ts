import { Horizon } from "@stellar/stellar-sdk";
import FreighterApi from "@stellar/freighter-api";

// Map of Stellar network names to Horizon URLs
const HORIZON_URLS: Record<string, string> = {
  "Public Global Stellar Network ; September 2015":
    "https://horizon.stellar.org",
  "Test SDF Network ; September 2015": "https://horizon-testnet.stellar.org",
};

// Default to testnet
export const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";

let currentServer: Horizon.Server | null = null;
let currentNetworkName: string | null = null;

/**
 * Get or create a Stellar Server instance based on the current Freighter network
 */
export async function getServer(): Promise<Horizon.Server> {
  try {
    // Fetch current network details from Freighter
    const networkDetails = await FreighterApi.getNetworkDetails();
    const networkName = networkDetails.network;

    // Only recreate server if network changed
    if (currentNetworkName === networkName && currentServer) {
      return currentServer;
    }

    const horizonUrl =
      HORIZON_URLS[networkName] ||
      networkDetails.networkUrl ||
      DEFAULT_HORIZON_URL;
    console.log(`Switching to network: ${networkName} (${horizonUrl})`);

    currentServer = new Horizon.Server(horizonUrl);
    currentNetworkName = networkName;
    return currentServer;
  } catch (err) {
    console.warn("Failed to detect Freighter network, using testnet:", err);
    if (!currentServer) {
      currentServer = new Horizon.Server(DEFAULT_HORIZON_URL);
      currentNetworkName = "Test SDF Network ; September 2015";
    }
    return currentServer;
  }
}

export async function getXlmBalance(address: string): Promise<string> {
  try {
    const server = await getServer();
    const account = await server.loadAccount(address);
    const native = account.balances.find(
      (b: { asset_type: string }) => b.asset_type === "native",
    );
    // Balance is a string already, return it or '0'
    return native?.balance ?? "0";
  } catch (err: unknown) {
    // If account not found (404), throw a generic message
    if (err instanceof Error && err.message.includes("404")) {
      throw new Error(
        "Account not found on this network. Please ensure the account is funded.",
      );
    }
    throw err;
  }
}

/**
 * Get the current network name from Freighter (or the cached one from getServer)
 */
export async function getCurrentNetworkName(): Promise<string> {
  try {
    const networkDetails = await FreighterApi.getNetworkDetails();
    return networkDetails.network;
  } catch (err) {
    // If we can't reach Freighter, return the cached network name (if available)
    // or fall back to testnet
    console.warn("Failed to get network name:", err);
    return currentNetworkName || "Test SDF Network ; September 2015";
  }
}
