import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  adapter: {
    id: "freighter",
    name: "Freighter",
    iconUrl: "",
    installUrl: "",
    moduleType: "browser",
    platforms: ["browser"],
    supportsDeepLink: false,
    isAvailable: vi.fn(async () => true),
    getPublicKey: vi.fn(async () => "GTEST"),
    getNetwork: vi.fn(async () => ({ networkPassphrase: "Test SDF Network ; September 2015" })),
    signTransaction: vi.fn(async (xdr: string) => xdr),
    disconnect: vi.fn(async () => {}),
  },
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class MockRpcServer {
      sendTransaction = doubles.sendTransaction;
      getTransaction = doubles.getTransaction;
      constructor(_url: string) {}
    },
    Api: { GetTransactionStatus: { NOT_FOUND: "NOT_FOUND", SUCCESS: "SUCCESS", FAILED: "FAILED" } },
  },
  TransactionBuilder: { fromXDR: (xdr: string) => xdr },
}));
vi.mock("@/lib/wallets/registry", () => ({
  DEFAULT_WALLET_ID: "freighter",
  getWalletAdapter: () => doubles.adapter,
}));
vi.mock("@/lib/walletSession", () => ({ loadWalletSession: () => ({ walletId: "freighter" }) }));

import { signAndSubmitTransaction } from "../lib/signTransaction";

describe("signAndSubmitTransaction wallet boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doubles.adapter.getNetwork.mockResolvedValue({ networkPassphrase: "Test SDF Network ; September 2015" });
    doubles.adapter.signTransaction.mockImplementation(async (xdr: string) => xdr);
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "TXHASH" });
    doubles.getTransaction.mockResolvedValue({ status: "SUCCESS" });
  });

  it("uses the active wallet adapter and returns a confirmed result", async () => {
    const result = await signAndSubmitTransaction("XDR");

    expect(result).toMatchObject({ success: true, outcome: "confirmed", txHash: "TXHASH" });
    expect(doubles.adapter.signTransaction).toHaveBeenCalledWith("XDR", {
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(doubles.sendTransaction).toHaveBeenCalledWith("XDR");
  });

  it("surfaces a wallet rejection without submitting", async () => {
    doubles.adapter.signTransaction.mockResolvedValue("");

    const result = await signAndSubmitTransaction("XDR");

    expect(result).toMatchObject({ success: false, outcome: "failed", error: "Transaction rejected by wallet" });
    expect(doubles.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects a wallet connected to the wrong network", async () => {
    doubles.adapter.getNetwork.mockResolvedValue({ networkPassphrase: "Public Global Stellar Network ; September 2015" });

    const result = await signAndSubmitTransaction("XDR");

    expect(result.error).toContain("Network mismatch");
    expect(doubles.adapter.signTransaction).not.toHaveBeenCalled();
    expect(doubles.sendTransaction).not.toHaveBeenCalled();
  });

  it("returns submission failures from RPC", async () => {
    doubles.sendTransaction.mockResolvedValue({ status: "ERROR" });

    const result = await signAndSubmitTransaction("XDR");

    expect(result).toMatchObject({ success: false, outcome: "failed", error: "Submission failed: ERROR" });
    expect(doubles.getTransaction).not.toHaveBeenCalled();
  });
});
