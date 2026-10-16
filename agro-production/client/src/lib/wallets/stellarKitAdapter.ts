import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  WalletConnectModule,
  WalletConnectTargetChain,
} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import { Networks, type ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { WalletRejectionError } from "./errors";
import type {
  WalletAccessOptions,
  WalletAdapter,
  WalletPlatform,
} from "./types";

export const ENABLED_WALLET_IDS = [
  "freighter",
  "xbull",
  "albedo",
  "rabet",
  "hana",
  "lobstr",
] as const;

const enabledWalletIds = new Set<string>(ENABLED_WALLET_IDS);

const platformMatrix: Record<string, WalletPlatform[]> = {
  freighter: ["browser", "mobile"],
  xbull: ["browser", "web", "mobile"],
  albedo: ["web", "mobile"],
  rabet: ["browser"],
  hana: ["browser"],
  lobstr: ["browser", "mobile"],
  wallet_connect: ["mobile"],
};

export interface WalletKitFacade {
  setWallet(id: string): void;
  getAddress(): Promise<{ address: string }>;
  fetchAddress(): Promise<{ address: string }>;
  getNetwork(): Promise<{ networkPassphrase: string }>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string }>;
  disconnect(): Promise<void>;
}

function configuredNetwork(): Networks {
  const passphrase =
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;
  return Object.values(Networks).includes(passphrase as Networks)
    ? (passphrase as Networks)
    : Networks.TESTNET;
}

function walletConnectModule(): ModuleInterface | undefined {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) return undefined;

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3001";

  return new WalletConnectModule({
    projectId,
    metadata: {
      name: "AgroCylo",
      description: "AgroCylo agricultural marketplace",
      url: appUrl,
      icons: [`${appUrl.replace(/\/$/, "")}/favicon.ico`],
    },
    allowedChains: [
      WalletConnectTargetChain.PUBLIC,
      WalletConnectTargetChain.TESTNET,
    ],
  });
}

function buildModules(): ModuleInterface[] {
  const modules = defaultModules({
    filterBy: (module) => enabledWalletIds.has(module.productId),
  });
  const walletConnect = walletConnectModule();
  return walletConnect ? [...modules, walletConnect] : modules;
}

export const WALLET_KIT_MODULES = buildModules();

let initialized = false;

export function initializeWalletKit(selectedWalletId?: string): void {
  if (!initialized) {
    StellarWalletsKit.init({
      modules: WALLET_KIT_MODULES,
      network: configuredNetwork(),
      selectedWalletId:
        selectedWalletId &&
        WALLET_KIT_MODULES.some((module) => module.productId === selectedWalletId)
          ? selectedWalletId
          : undefined,
      authModal: {
        showInstallLabel: true,
        hideUnsupportedWallets: false,
      },
    });
    initialized = true;
    return;
  }

  if (
    selectedWalletId &&
    WALLET_KIT_MODULES.some((module) => module.productId === selectedWalletId)
  ) {
    StellarWalletsKit.setWallet(selectedWalletId);
  }
}

export function createKitWalletAdapter(
  module: ModuleInterface,
  kit: WalletKitFacade = StellarWalletsKit,
): WalletAdapter {
  return {
    id: module.productId,
    name: module.productName,
    iconUrl: module.productIcon,
    installUrl: module.productUrl,
    moduleType: module.moduleType,
    platforms: platformMatrix[module.productId] ?? ["browser"],
    supportsDeepLink: ["albedo", "xbull", "lobstr", "wallet_connect"].includes(
      module.productId,
    ),

    async isAvailable() {
      try {
        return await module.isAvailable();
      } catch {
        return false;
      }
    },

    async getPublicKey(options: WalletAccessOptions = {}) {
      initializeWalletKit(module.productId);
      kit.setWallet(module.productId);

      if (options.silent) {
        // The kit only remembers the address in memory, so after a page
        // refresh fall back to reading it from the module while skipping any
        // permission prompt.
        try {
          const { address } = await kit.getAddress();
          if (address) return address;
        } catch {
          /* not in memory yet — re-read from the module below */
        }
        try {
          const { address } = await module.getAddress({
            skipRequestAccess: true,
          });
          return address || null;
        } catch {
          return null;
        }
      }

      const { address } = await kit.fetchAddress();
      return address || null;
    },

    async getNetwork() {
      initializeWalletKit(module.productId);
      kit.setWallet(module.productId);
      try {
        const { networkPassphrase } = await kit.getNetwork();
        return networkPassphrase ? { networkPassphrase } : null;
      } catch {
        return null;
      }
    },

    async signTransaction(xdr, opts) {
      initializeWalletKit(module.productId);
      kit.setWallet(module.productId);
      const { signedTxXdr } = await kit.signTransaction(xdr, opts);
      if (!signedTxXdr) {
        throw new WalletRejectionError(
          module.productId,
          `Transaction rejected by ${module.productName}`,
        );
      }
      return signedTxXdr;
    },

    async disconnect() {
      await kit.disconnect();
    },
  };
}

export const KIT_WALLET_ADAPTERS = WALLET_KIT_MODULES.map((module) =>
  createKitWalletAdapter(module),
);

export async function connectWithWalletModal(): Promise<{
  address: string;
  walletId: string;
}> {
  initializeWalletKit();
  const { address } = await StellarWalletsKit.authModal();
  return {
    address,
    walletId: StellarWalletsKit.selectedModule.productId,
  };
}

export async function refreshWalletAvailability(): Promise<
  Array<{ id: string; available: boolean }>
> {
  initializeWalletKit();
  const wallets = await StellarWalletsKit.refreshSupportedWallets();
  return wallets.map((wallet) => ({
    id: wallet.id,
    available: wallet.isAvailable || wallet.isPlatformWrapper,
  }));
}

export async function disconnectWallet(): Promise<void> {
  if (!initialized) return;
  await StellarWalletsKit.disconnect();
}
