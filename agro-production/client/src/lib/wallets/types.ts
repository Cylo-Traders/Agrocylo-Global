export type WalletPlatform = "browser" | "web" | "mobile" | "hardware";

/**
 * What a wallet can prove about the network it is connected to (#1087).
 *
 * `getNetwork()` returning `null` means the wallet could not report a
 * passphrase — that is an *unknown* network, not a match. Callers must treat
 * it as unknown (block the financial action, surface it in the UI) instead of
 * substituting the configured passphrase.
 */
export interface WalletNetworkDetails {
  networkPassphrase: string;
}

export interface WalletAccessOptions {
  /** Read the kit's persisted session without opening a permission prompt. */
  silent?: boolean;
}

export interface WalletAdapter {
  id: string;
  name: string;
  iconUrl: string;
  installUrl: string;
  moduleType: string;
  platforms: WalletPlatform[];
  supportsDeepLink: boolean;
  isAvailable(): Promise<boolean>;
  getPublicKey(options?: WalletAccessOptions): Promise<string | null>;
  getNetwork(): Promise<WalletNetworkDetails | null>;
  signTransaction(
    xdr: string,
    opts: { networkPassphrase: string; address?: string },
  ): Promise<string>;
  disconnect(): Promise<void>;
}
