import type { SignAndSubmitResult } from "../lib/signTransaction";

export type ProfileRole = "farmer" | "buyer" | "admin";

export interface WalletState {
  address: string | null;
  balance: string | null; // XLM balance as human-readable string
  connected: boolean;
  loading: boolean;
  error: string | null;
  network: string | null; // Current Stellar network name
  activeWalletId: string | null; // ID of the currently active wallet adapter
  restoring: boolean; // true when restoring from localStorage
}

export interface WalletContextType extends WalletState {
  /** Connect using the specified wallet adapter ID, or the user's saved preference. */
  connect: (adapterId?: string) => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  /** Sign a transaction XDR with the active wallet, submit it, and wait for confirmation. */
  signAndSubmit: (transactionXdr: string) => Promise<SignAndSubmitResult>;
}

export function isAdminRole(role: ProfileRole | string | undefined | null): boolean {
  return role === "admin" || role?.toUpperCase() === "ADMIN";
}
