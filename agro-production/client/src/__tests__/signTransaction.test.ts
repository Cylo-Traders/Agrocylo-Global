import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@stellar/freighter-api", () => ({
  signTransaction: vi.fn(async (xdr: string) => xdr),
  getNetworkDetails: vi.fn(async () => ({ networkPassphrase: "Test" })),
}));

// mock stellar-sdk rpc.Server and TransactionBuilder
vi.mock("@stellar/stellar-sdk", () => {
  const mockServer = function () {
    return {
      sendTransaction: vi.fn(async () => ({ status: "OK", hash: "TXHASH" })),
      getTransaction: vi.fn(async () => ({ status: "SUCCESS" })),
    };
  } as any;

  return {
    rpc: { Server: mockServer, Api: { GetTransactionStatus: { NOT_FOUND: "NOT_FOUND", SUCCESS: "SUCCESS" } } },
    TransactionBuilder: { fromXDR: (x: string) => x },
  };
});

import { signAndSubmitTransaction } from "../lib/signTransaction";

describe("signAndSubmitTransaction", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns success when signer and rpc succeed", async () => {
    (globalThis as any).freighterApi = { signTransaction: async (x: string) => x };
    const res = await signAndSubmitTransaction("XDR_PLACEHOLDER");
    expect(res.success).toBe(true);
    expect(res.txHash).toBe("TXHASH");
  });
});
