import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";

const fixtures = vi.hoisted(() => {
  const ids = ["freighter", "xbull", "albedo", "rabet", "hana", "lobstr"];
  return ids.map((id) => ({
    moduleType: "HOT_WALLET",
    productId: id,
    productName: id === "xbull" ? "xBull" : id[0].toUpperCase() + id.slice(1),
    productUrl: `https://wallet.example/${id}`,
    productIcon: `https://wallet.example/${id}.png`,
    isAvailable: vi.fn(async () => true),
    getAddress: vi.fn(async () => ({ address: `G${id.toUpperCase()}` })),
    getNetwork: vi.fn(async () => ({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    })),
    signTransaction: vi.fn(async () => ({
      signedTxXdr: `SIGNED_${id}`,
    })),
  }));
});

const kit = vi.hoisted(() => ({
  init: vi.fn(),
  setWallet: vi.fn(),
  getAddress: vi.fn(async () => ({ address: "GPERSISTED" })),
  fetchAddress: vi.fn(async () => ({ address: "GCONNECTED" })),
  getNetwork: vi.fn(async () => ({
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015",
  })),
  signTransaction: vi.fn(async () => ({ signedTxXdr: "SIGNED_XDR" })),
  disconnect: vi.fn(async () => undefined),
  refreshSupportedWallets: vi.fn(async () =>
    fixtures.map((module) => ({
      id: module.productId,
      name: module.productName,
      type: module.moduleType,
      icon: module.productIcon,
      url: module.productUrl,
      isAvailable: true,
      isPlatformWrapper: false,
    })),
  ),
  authModal: vi.fn(async () => ({ address: "GMODAL" })),
  selectedModule: { productId: "freighter" },
}));

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: kit,
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: ({
    filterBy,
  }: {
    filterBy: (module: ModuleInterface) => boolean;
  }) => fixtures.filter((module) => filterBy(module as unknown as ModuleInterface)),
}));

vi.mock("@creit.tech/stellar-wallets-kit/modules/wallet-connect", () => ({
  WalletConnectModule: class {},
  WalletConnectTargetChain: {
    PUBLIC: "stellar:pubnet",
    TESTNET: "stellar:testnet",
  },
}));

vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
    FUTURENET: "Test SDF Future Network ; October 2022",
    SANDBOX: "Local Sandbox Stellar Network ; September 2022",
    STANDALONE: "Standalone Network ; February 2017",
  },
}));

import {
  DEFAULT_WALLET_ID,
  getWalletAdapter,
  WALLET_ADAPTERS,
} from "../lib/wallets/registry";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

describe("Stellar Wallets Kit adapter contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kit.getAddress.mockResolvedValue({ address: "GPERSISTED" });
    kit.fetchAddress.mockResolvedValue({ address: "GCONNECTED" });
    kit.getNetwork.mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    kit.signTransaction.mockResolvedValue({ signedTxXdr: "SIGNED_XDR" });
  });

  it("enables the reviewed cross-platform module set", () => {
    expect(WALLET_ADAPTERS.map((adapter) => adapter.id)).toEqual([
      "freighter",
      "xbull",
      "albedo",
      "rabet",
      "hana",
      "lobstr",
    ]);
    expect(DEFAULT_WALLET_ID).toBe("freighter");
  });

  it("falls back to the default adapter for an unknown persisted id", () => {
    expect(getWalletAdapter("removed-provider").id).toBe(DEFAULT_WALLET_ID);
    expect(getWalletAdapter(undefined).id).toBe(DEFAULT_WALLET_ID);
  });

  for (const fixture of fixtures) {
    it(`${fixture.productName} satisfies connection, network, signing, and disconnect`, async () => {
      const adapter = getWalletAdapter(fixture.productId);

      expect(adapter.name).toBe(fixture.productName);
      expect(adapter.iconUrl).toBe(fixture.productIcon);
      expect(adapter.installUrl).toBe(fixture.productUrl);
      await expect(adapter.isAvailable()).resolves.toBe(true);
      await expect(adapter.getPublicKey()).resolves.toBe("GCONNECTED");
      await expect(adapter.getNetwork()).resolves.toEqual({
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      await expect(
        adapter.signTransaction("XDR", {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: "GCONNECTED",
        }),
      ).resolves.toBe("SIGNED_XDR");
      await adapter.disconnect();

      expect(kit.setWallet).toHaveBeenCalledWith(fixture.productId);
      expect(kit.signTransaction).toHaveBeenCalledWith("XDR", {
        networkPassphrase: NETWORK_PASSPHRASE,
        address: "GCONNECTED",
      });
      expect(kit.disconnect).toHaveBeenCalled();
    });
  }

  it("restores the kit's persisted address without requesting wallet access", async () => {
    await expect(
      getWalletAdapter("freighter").getPublicKey({ silent: true }),
    ).resolves.toBe("GPERSISTED");
    expect(kit.getAddress).toHaveBeenCalled();
    expect(kit.fetchAddress).not.toHaveBeenCalled();
  });

  it("re-reads the address from the module after a refresh, without prompting", async () => {
    const [xbull] = fixtures.filter((module) => module.productId === "xbull");
    kit.getAddress.mockResolvedValueOnce({ address: "" } as never);
    await expect(
      getWalletAdapter("xbull").getPublicKey({ silent: true }),
    ).resolves.toBe("GXBULL");
    expect(xbull?.getAddress).toHaveBeenCalledWith({ skipRequestAccess: true });
    expect(kit.fetchAddress).not.toHaveBeenCalled();
  });

  it("reports no address when the provider cannot be read without a prompt", async () => {
    const [hana] = fixtures.filter((module) => module.productId === "hana");
    kit.getAddress.mockResolvedValueOnce({ address: "" } as never);
    hana?.getAddress.mockRejectedValueOnce(new Error("locked"));
    await expect(
      getWalletAdapter("hana").getPublicKey({ silent: true }),
    ).resolves.toBeNull();
  });

  it("normalizes an unavailable provider to false", async () => {
    fixtures[0].isAvailable.mockRejectedValueOnce(new Error("not installed"));
    await expect(getWalletAdapter("freighter").isAvailable()).resolves.toBe(false);
  });

  it("rejects an empty signed XDR", async () => {
    kit.signTransaction.mockResolvedValueOnce({ signedTxXdr: "" });
    await expect(
      getWalletAdapter("hana").signTransaction("XDR", {
        networkPassphrase: NETWORK_PASSPHRASE,
      }),
    ).rejects.toThrow("Transaction rejected by Hana");
  });
});
