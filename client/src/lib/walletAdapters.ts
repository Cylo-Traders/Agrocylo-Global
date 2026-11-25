"use client";

import FreighterApi from "@stellar/freighter-api";

export interface WalletAdapter {
  id: string;
  name: string;
  icon: string;
  /** Returns true if this wallet is available in the current browser/environment. */
  isAvailable(): boolean;
  /** Returns true if this adapter supports mobile browsers. */
  supportsMobile(): boolean;
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;
  /** Signs a UTF-8 authentication challenge when the wallet supports it. */
  signMessage?(message: string, address: string): Promise<string>;
  /** Returns the deep-link URL to open the wallet on mobile, or null if unsupported. */
  mobileDeepLink(): string | null;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}
  /**
   * Interactive: asks the user to authorize this site. May open the wallet
   * popup. Only call this from an explicit user action (Connect button).
   */
  connect(): Promise<string>;
  /**
   * Silent: returns the already-authorized public key. MUST NOT open a popup.
   * Used by session restore and the identity poll. Throws when the site is
   * not (or no longer) authorized / the wallet is locked.
   */
  getPublicKey(): Promise<string>;
  getNetwork(): Promise<string>;

// ─── Freighter adapter ──────────────────────────────────────────────────────

  async connect() {
    const direct = window.freighter ?? window.freighterApi ?? null;
    // FreighterApi.getPublicKey() opens the authorization popup when the site
    // is not yet allowed — this is the ONLY place we let that happen.
    const pub = direct
      ? await direct.getPublicKey()
      : await FreighterApi.getPublicKey();
    if (!pub) throw new Error("Freighter did not return a public key");
    return pub;
  },

  async getPublicKey() {
    const direct = window.freighter ?? window.freighterApi ?? null;
    if (direct) {
      const pub = await direct.getPublicKey();
      if (!pub) throw new Error("Freighter did not return a public key");
      return pub;
    }
    // Never call FreighterApi.getPublicKey() here: on an un-allowed site it
    // opens the extension popup, which made Freighter load twice (once from
    // connect, again from the 5s identity poll).
    const api = FreighterApi as unknown as {
      isAllowed?: () => Promise<boolean>;
      getUserInfo?: () => Promise<{ publicKey?: string }>;
    };
    if (api.isAllowed && !(await api.isAllowed())) {
      throw new Error("Freighter has not authorized this site");
    }
    if (api.getUserInfo) {
      const info = await api.getUserInfo();
      if (!info?.publicKey) throw new Error("Freighter is locked");
      return info.publicKey;
    }
    // Old extension without silent reads — allowed already, so this won't prompt.
    const pub = await FreighterApi.getPublicKey();
    if (!pub) throw new Error("Freighter did not return a public key");
    return pub;
  },
export const FreighterAdapter: WalletAdapter = {
  id: "freighter",
  name: "Freighter",
  icon: "/wallets/freighter.svg",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window.freighter ?? window.freighterApi) || !isMobile();
  },
    async connect() {
    const sdk = (window as XBullWindow).xBullSDK;
    if (!sdk) throw new Error("xBull wallet extension is not installed");
    await sdk.connect({ canRequestPublicKey: true });
    const pub = await sdk.getPublicKey();
    if (!pub) throw new Error("xBull did not return a public key");
    return pub;
  },

  async getPublicKey() {
    const sdk = (window as XBullWindow).xBullSDK;
    if (!sdk) throw new Error("xBull wallet extension is not installed");
    // Silent read: never sdk.connect() here — that re-opens the xBull popup
    // on every identity poll tick.
    if (!(await sdk.isConnected())) {
      throw new Error("xBull is not connected");
    }
    const pub = await sdk.getPublicKey();
    if (!pub) throw new Error("xBull did not return a public key");
    return pub;
  },

  supportsMobile() {
    return false;
  },

  mobileDeepLink() {
    return null;
  },

  async getPublicKey() {
    const direct = window.freighter ?? window.freighterApi ?? null;
    const pub = direct
      ? await direct.getPublicKey()
      : await FreighterApi.getPublicKey();
    if (!pub) throw new Error("Freighter did not return a public key");
    return pub;
  },

  async getNetwork() {
    const direct = window.freighter ?? window.freighterApi ?? null;
    if (direct?.getNetwork) return direct.getNetwork();
    const { getCurrentNetworkName } = await import("./stellar");
    return getCurrentNetworkName();
  },

  async signMessage(message, address) {
    const direct = window.freighter ?? window.freighterApi ?? null;
    const signer = direct?.signMessage
      ? direct
      : (FreighterApi as unknown as {
          signMessage?: (
            value: string,
            options?: { address?: string },
          ) => Promise<string | { signedMessage: string }>;
        });
    if (!signer.signMessage) {
      throw new Error(
        "This Freighter version cannot sign login messages. Update Freighter and try again.",
      );
    }
    const result = await signer.signMessage(message, { address });
    const signature =
      typeof result === "string" ? result : result.signedMessage;
    if (!signature)
      throw new Error("Freighter did not return a login signature");
    return signature;
  },
};

// ─── xBull adapter ─────────────────────────────────────────────────────────

type XBullWindow = Window & {
  xBullSDK?: {
    connect(opts?: {
      canRequestPublicKey?: boolean;
      canRequestSign?: boolean;
    }): Promise<void>;
    getPublicKey(): Promise<string>;
    isConnected(): Promise<boolean>;
  };
};

export const XBullAdapter: WalletAdapter = {
  id: "xbull",
  name: "xBull",
  icon: "/wallets/xbull.svg",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window as XBullWindow).xBullSDK;
  },

  supportsMobile() {
    return false;
  },

  mobileDeepLink() {
    return null;
  },

  async getPublicKey() {
    const sdk = (window as XBullWindow).xBullSDK;
    if (!sdk) throw new Error("xBull wallet extension is not installed");
    await sdk.connect({ canRequestPublicKey: true });
    const pub = await sdk.getPublicKey();
    if (!pub) throw new Error("xBull did not return a public key");
    return pub;
  },

  async getNetwork() {
    // xBull does not expose a getNetwork call; fall back to the Stellar horizon network.
    const { getCurrentNetworkName } = await import("./stellar");
    return getCurrentNetworkName();
  },
};

// ─── Rabet adapter ─────────────────────────────────────────────────────────

type RabetWindow = Window & {
  rabet?: {
    connect(): Promise<{ publicKey: string }>;
    getPublicKey(): Promise<string>;
    getNetwork(): Promise<{ network: string }>;
  };
};

export const RabetAdapter: WalletAdapter = {
  id: "rabet",
  name: "Rabet",
  icon: "/wallets/rabet.svg",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window as RabetWindow).rabet;
  },

  supportsMobile() {
    return true;
  },

  mobileDeepLink() {
    return "https://rabet.io";
  },

  async getPublicKey() {
    const rabet = (window as RabetWindow).rabet;
    if (!rabet) throw new Error("Rabet wallet extension is not installed");
    const result = await rabet.connect();
    if (!result.publicKey) throw new Error("Rabet did not return a public key");
    return result.publicKey;
  },

  async getNetwork() {
    const rabet = (window as RabetWindow).rabet;
    if (!rabet) throw new Error("Rabet wallet extension is not installed");
    const result = await rabet.getNetwork();
    return result.network;
  },
};

// ─── Albedo adapter (mobile-friendly, browser-based) ────────────────────────

type AlbedoWindow = Window & {
  albedo?: {
    connect(opts?: { username?: string }): Promise<{ publicKey: string }>;
    publicKey(): Promise<{ publicKey: string }>;
    network(): Promise<{ network: string }>;
  };
};

export const AlbedoAdapter: WalletAdapter = {
  id: "albedo",
  name: "Albedo",
  icon: "/wallets/albedo.svg",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window as AlbedoWindow).albedo;
  },

  supportsMobile() {
    return true;
  },

  mobileDeepLink() {
    return "https://albedo.io";
  },

  async getPublicKey() {
    const albedo = (window as AlbedoWindow).albedo;
    if (!albedo) throw new Error("Albedo is not installed");
    const result = await albedo.connect();
    if (!result.publicKey)
      throw new Error("Albedo did not return a public key");
    return result.publicKey;
  },

  async getNetwork() {
    const albedo = (window as AlbedoWindow).albedo;
    if (!albedo) throw new Error("Albedo is not installed");
    const result = await albedo.network();
    return result.network;
  },
};

// ─── LOBSTR adapter (mobile wallet with deep-link support) ──────────────────

type LOBSTRWindow = Window & {
  lobstr?: {
    getPublicKey(): Promise<string>;
    getNetwork(): Promise<string>;
    signTransaction(
      txXdr: string,
      opts?: { network?: string },
    ): Promise<{ signedTxXdr: string }>;
  };
};

export const LOBSTRAdapter: WalletAdapter = {
  id: "lobstr",
  name: "LOBSTR",
  icon: "/wallets/lobstr.svg",

  isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window as LOBSTRWindow).lobstr;
  },

  supportsMobile() {
    return true;
  },

  mobileDeepLink() {
    return "https://lobstr.co";
  },

  async getPublicKey() {
    const lobstr = (window as LOBSTRWindow).lobstr;
    if (!lobstr) throw new Error("LOBSTR vault extension is not installed");
    const pub = await lobstr.getPublicKey();
    if (!pub) throw new Error("LOBSTR did not return a public key");
    return pub;
  },

  async getNetwork() {
    const lobstr = (window as LOBSTRWindow).lobstr;
    if (!lobstr) throw new Error("LOBSTR vault extension is not installed");
    return lobstr.getNetwork();
  },
};

// ─── Registry ──────────────────────────────────────────────────────────────

export const WALLET_ADAPTERS: WalletAdapter[] = [
  FreighterAdapter,
  XBullAdapter,
  RabetAdapter,
  AlbedoAdapter,
  LOBSTRAdapter,
];

export const WALLET_PREFERENCE_KEY = "preferredWallet";

export function getPreferredAdapter(): WalletAdapter {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem(WALLET_PREFERENCE_KEY);
    if (saved) {
      const found = WALLET_ADAPTERS.find((a) => a.id === saved);
      if (found) return found;
    }
  }
  return FreighterAdapter;
}

export function savePreferredAdapter(id: string) {
  localStorage.setItem(WALLET_PREFERENCE_KEY, id);
}
