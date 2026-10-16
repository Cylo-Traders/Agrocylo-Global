import {
  connectWithWalletModal,
  disconnectWallet,
  initializeWalletKit,
  KIT_WALLET_ADAPTERS,
  refreshWalletAvailability,
} from "./stellarKitAdapter";
import type { WalletAdapter } from "./types";

export const WALLET_ADAPTERS: WalletAdapter[] = KIT_WALLET_ADAPTERS;
export const DEFAULT_WALLET_ID = "freighter";

export function getWalletAdapter(id: string | null | undefined): WalletAdapter {
  const adapter =
    WALLET_ADAPTERS.find((candidate) => candidate.id === id) ??
    WALLET_ADAPTERS.find((candidate) => candidate.id === DEFAULT_WALLET_ID) ??
    WALLET_ADAPTERS[0];
  if (!adapter) throw new Error("No Stellar wallet modules are enabled");
  return adapter;
}

export {
  connectWithWalletModal,
  disconnectWallet,
  initializeWalletKit,
  refreshWalletAvailability,
};
export type { WalletAdapter } from "./types";
