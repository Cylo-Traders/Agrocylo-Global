import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
  signTransaction: vi.fn(async (xdr: string) => xdr),
  getNetwork: vi.fn(async () => ({ networkPassphrase: "Test SDF Network ; September 2015" })),
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
import {
  clearPendingTransactions,
  getPendingTransactions,
  recordSubmittedTransaction,
} from "../lib/pendingTransactions";

describe("signAndSubmitTransaction confirmation polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearPendingTransactions();
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports an unconfirmed transaction as pending", async () => {
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_PENDING" });
    doubles.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const resultPromise = signAndSubmitTransaction("XDR", undefined, {
      intent: "invest:c1:GABC",
      confirmTimeoutMs: 10,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ outcome: "pending", success: false, txHash: "HASH_PENDING" });
    expect(result.error).not.toBe("Transaction failed on-chain");
  });

  it("reports confirmed status after a later poll", async () => {
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_OK" });
    doubles.getTransaction.mockResolvedValueOnce({ status: "NOT_FOUND" }).mockResolvedValue({ status: "SUCCESS" });
    const resultPromise = signAndSubmitTransaction("XDR", undefined, {
      intent: "invest:c2:GABC",
      confirmTimeoutMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(result).toMatchObject({ outcome: "confirmed", success: true, txHash: "HASH_OK" });
    expect(getPendingTransactions()[0].status).toBe("confirmed");
  });

  it("reports an on-chain failure", async () => {
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_FAILED" });
    doubles.getTransaction.mockResolvedValue({ status: "FAILED" });

    const result = await signAndSubmitTransaction("XDR", undefined, { intent: "order:o1:GABC" });

    expect(result).toMatchObject({ outcome: "failed", status: "FAILED" });
    expect(getPendingTransactions()[0].status).toBe("failed");
  });

  it("blocks a duplicate intent before signing or submitting", async () => {
    recordSubmittedTransaction({ intent: "invest:c1:GABC", hash: "HASH_INFLIGHT", timeoutSeconds: 30 });

    const result = await signAndSubmitTransaction("XDR", undefined, { intent: "invest:c1:GABC" });

    expect(result).toMatchObject({ outcome: "pending", duplicate: true, txHash: "HASH_INFLIGHT" });
    expect(doubles.sendTransaction).not.toHaveBeenCalled();
    expect(doubles.adapter.signTransaction).not.toHaveBeenCalled();
  });

  it("persists an unresolved hash for post-refresh resolution", async () => {
    doubles.sendTransaction.mockResolvedValue({ status: "PENDING", hash: "HASH_PERSIST" });
    doubles.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
    const resultPromise = signAndSubmitTransaction("XDR", undefined, {
      intent: "order:o9:GXYZ",
      confirmTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await resultPromise;

    expect(getPendingTransactions()).toContainEqual(expect.objectContaining({
      intent: "order:o9:GXYZ",
      hash: "HASH_PERSIST",
      status: "submitted",
    }));
  });
});
