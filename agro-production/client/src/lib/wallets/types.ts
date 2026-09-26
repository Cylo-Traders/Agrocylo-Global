export type WalletPlatform = "browser" | "web" | "mobile" | "hardware";

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
