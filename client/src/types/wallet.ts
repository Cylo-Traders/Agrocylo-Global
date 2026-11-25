import type { SignAndSubmitResult } from "../lib/stellarTransactions";
import type { UserRole } from "./user";

export type ProfileRole = UserRole;

export interface WalletState {
  address: string | null;
  balance: string | null; // XLM balance as human-readable string
  connected: boolean;
  loading: boolean;
  error: string | null;
  network: string | null; // Current Stellar network name
  /** true when the connected wallet's network differs from the app's configured network */
  networkMismatch: boolean;
  activeWalletId: string | null; // ID of the currently active wallet adapter
  restoring: boolean; // true when restoring from localStorage
  authenticated: boolean;
  authenticating: boolean;
  sessionError: string | null;
}

/**
 * Single source of truth for the wallet lifecycle. Only one wallet
 * interaction (restore / connect / sign-in) can be in flight at a time.
 *
 *   disconnected ─connect()→ connecting ─→ connected ─reauthenticate()→ authenticating ─→ ready
 *        ↑ restoring (page load) ───────────┘                                   │
 *        └──────────────────────── disconnect() / identity change ──────────────┘
 */
export type WalletStatus =
  | "disconnected"
  | "restoring"
  | "connecting"
  | "connected"
  | "authenticating"
  | "ready";

export interface WalletState {
  /** Unified lifecycle status — prefer this over the legacy boolean flags. */
  status: WalletStatus;
  /** true while any wallet interaction (restore/connect/sign-in) is in flight. */
  busy: boolean;
  /** Adapter id currently being connected, for per-row spinners. */
  pendingWalletId: string | null;
  address: string | null;
  balance: string | null; // XLM balance as human-readable string
  connected: boolean;
  /** @deprecated derived: status === "connecting" */
  loading: boolean;
  error: string | null;
  network: string | null; // Current Stellar network name
  /** true when the connected wallet's network differs from the app's configured network */
  networkMismatch: boolean;
  activeWalletId: string | null; // ID of the currently active wallet adapter
  /** @deprecated derived: status === "restoring" */
  restoring: boolean;
  authenticated: boolean;
  /** @deprecated derived: status === "authenticating" */
  authenticating: boolean;
  sessionError: string | null;
}

export interface WalletContextType extends WalletState {
  /** Connect using the specified wallet adapter ID, or the user's saved preference. */
  connect: (adapterId?: string) => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  reauthenticate: () => Promise<void>;
  /** Sign a transaction XDR with the active wallet, submit it, and wait for confirmation. */
  signAndSubmit: (transactionXdr: string) => Promise<SignAndSubmitResult>;
}

export function isAdminRole(
  role: ProfileRole | string | undefined | null,
): boolean {
  return role === "admin" || role?.toUpperCase() === "ADMIN";
}
