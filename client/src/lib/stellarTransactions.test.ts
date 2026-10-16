import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as txModule from "./stellarTransactions";
import {
  NetworkMismatchError,
  TimeoutError,
  TransactionFailedError,
  NetworkError,
  XdrMismatchError,
  verifySignedXdrInvariants,
} from "./stellarTransactions";

vi.mock("@stellar/freighter-api", () => ({
  default: {
    getNetworkDetails: vi.fn(),
    signTransaction: vi.fn(),
  },
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    TransactionBuilder: {
      ...actual.TransactionBuilder,
      fromXDR: vi.fn(() => ({ _mockTx: true })),
    },
  };
});

const getRpcServer = vi.fn();
vi.mock("./stellar", () => ({ getRpcServer: () => getRpcServer() }));
vi.mock("./testMode", () => ({ isTestMode: vi.fn(() => false) }));

import FreighterApi from "@stellar/freighter-api";
import { TransactionBuilder } from "@stellar/stellar-sdk";

const VALID_XDR = "AAAAAgAAAAABAABkdwAAAAIAAAABAAAAFgAAAAAABcekAAAB4w==";
const MAINNET = "Public Global Stellar Network ; September 2015";
const TESTNET = "Test SDF Network ; September 2015";

const freighter = FreighterApi as unknown as {
  getNetworkDetails: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
};

// A minimal rpc.Server stub whose getTransaction sequence is scripted per test.
function mockServer(opts: {
  send?: unknown | (() => unknown);
  getTransaction: Array<{ status: string; resultMetaXdr?: { toXDR: () => string } }>;
}) {
  let i = 0;
  return {
    sendTransaction: vi.fn(async () => {
      const s = typeof opts.send === "function" ? (opts.send as () => unknown)() : opts.send;
      if (s instanceof Error) throw s;
      return s ?? { status: "PENDING", hash: "abc123" };
    }),
    getTransaction: vi.fn(async () => {
      const next = opts.getTransaction[Math.min(i, opts.getTransaction.length - 1)];
      i += 1;
      return next;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_STELLAR_ENV", "testnet");
  vi.stubEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE", TESTNET);
  freighter.getNetworkDetails.mockResolvedValue({ networkPassphrase: TESTNET });
  freighter.signTransaction.mockResolvedValue(VALID_XDR);
});

afterEach(() => vi.unstubAllEnvs());

describe("stellarTransactions — success path", () => {
  it("signAndSubmitTransaction resolves with SUCCESS and a hash", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({
        send: { status: "PENDING", hash: "hash-ok" },
        getTransaction: [
          { status: "NOT_FOUND" },
          { status: "SUCCESS", resultMetaXdr: { toXDR: () => "meta64" } },
        ],
      }),
    );

    const result = await txModule.signAndSubmitTransaction(VALID_XDR, {
      intervalMs: 1,
    });

    expect(result).toMatchObject({
      success: true,
      status: "SUCCESS",
      txHash: "hash-ok",
      resultXdr: "meta64",
    });
  });
});

describe("stellarTransactions — failure path", () => {
  it("surfaces a TransactionFailedError as errorKind 'failed'", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({
        send: { status: "PENDING", hash: "hash-fail" },
        getTransaction: [{ status: "FAILED", resultMetaXdr: { toXDR: () => "m" } }],
      }),
    );

    const result = await txModule.signAndSubmitTransaction(VALID_XDR, { intervalMs: 1 });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("failed");
    expect(result.txHash).toBe("hash-fail");
  });

  it("submitTransactionOrThrow throws TransactionFailedError on a terminal on-chain failure", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({
        send: { status: "PENDING", hash: "h" },
        getTransaction: [{ status: "FAILED" }],
      }),
    );
    await expect(
      txModule.submitTransactionOrThrow(VALID_XDR, { intervalMs: 1 }),
    ).rejects.toBeInstanceOf(TransactionFailedError);
  });
});

describe("stellarTransactions — timeout path", () => {
  it("surfaces a TimeoutError as errorKind 'timeout' when the tx never confirms", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({
        send: { status: "PENDING", hash: "hash-timeout" },
        getTransaction: [{ status: "NOT_FOUND" }],
      }),
    );

    const result = await txModule.signAndSubmitTransaction(VALID_XDR, {
      timeoutMs: 5,
      intervalMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("timeout");
    expect(result.status).toBe("TIMEOUT");
  });

  it("submitTransactionOrThrow throws TimeoutError", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({
        send: { status: "PENDING", hash: "h" },
        getTransaction: [{ status: "NOT_FOUND" }],
      }),
    );
    await expect(
      txModule.submitTransactionOrThrow(VALID_XDR, { timeoutMs: 5, intervalMs: 1 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("stellarTransactions — network / retry path", () => {
  it("retries transient send errors then gives up with a NetworkError", async () => {
    const server = mockServer({
      send: () => new Error("Failed to fetch"),
      getTransaction: [{ status: "NOT_FOUND" }],
    });
    getRpcServer.mockResolvedValue(server);

    const result = await txModule.signAndSubmitTransaction(VALID_XDR, {
      maxRetries: 2,
      baseDelayMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("network");
    expect(server.sendTransaction).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("submitTransactionOrThrow throws NetworkError after exhausting retries", async () => {
    getRpcServer.mockResolvedValue(
      mockServer({ send: () => new Error("503"), getTransaction: [{ status: "NOT_FOUND" }] }),
    );
    await expect(
      txModule.submitTransactionOrThrow(VALID_XDR, { maxRetries: 1, baseDelayMs: 1 }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ── #993 — verifySignedXdrInvariants ─────────────────────────────────────────

// Builds a minimal Transaction-like object that satisfies TxLike.
function makeTxStub(overrides: {
  source?: string;
  sequence?: string;
  fee?: string;
  timeBounds?: { minTime?: string; maxTime?: string };
  operations?: Array<{ type: string; func?: { toXDR: (fmt: string) => string } }>;
  hashHex?: string;
} = {}) {
  const hashHex = overrides.hashHex ?? "aabbccdd";
  return {
    source: overrides.source ?? "GABC1111111111111111111111111111111111111111111111111111",
    sequence: overrides.sequence ?? "12345",
    fee: overrides.fee ?? "100",
    timeBounds: overrides.timeBounds ?? { minTime: "0", maxTime: "9999999999" },
    operations: overrides.operations ?? [
      { type: "invokeHostFunction", func: { toXDR: (_fmt: string) => "funcXDR==" } },
    ],
    hash() {
      return Buffer.from(hashHex, "hex");
    },
  };
}

describe("verifySignedXdrInvariants — XDR mutation rejection (#993)", () => {
  let fromXDR: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromXDR = vi.mocked(TransactionBuilder.fromXDR);
  });

  it("passes when prepared and signed transactions are identical", () => {
    const tx = makeTxStub();
    fromXDR.mockReturnValue(tx);

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).not.toThrow();
  });

  it("passes when the only difference is added signatures (same hash)", () => {
    const prepared = makeTxStub({ hashHex: "deadbeef" });
    const signed = makeTxStub({ hashHex: "deadbeef" }); // same hash
    fromXDR
      .mockReturnValueOnce(prepared)
      .mockReturnValueOnce(signed);

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).not.toThrow();
  });

  it("rejects when the source account is altered", () => {
    fromXDR
      .mockReturnValueOnce(makeTxStub({ source: "GABC", hashHex: "0001" }))
      .mockReturnValueOnce(makeTxStub({ source: "GXYZ", hashHex: "0002" }));

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("rejects when the sequence number is altered", () => {
    fromXDR
      .mockReturnValueOnce(makeTxStub({ sequence: "1", hashHex: "0001" }))
      .mockReturnValueOnce(makeTxStub({ sequence: "2", hashHex: "0002" }));

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("rejects when the fee is altered", () => {
    fromXDR
      .mockReturnValueOnce(makeTxStub({ fee: "100", hashHex: "0001" }))
      .mockReturnValueOnce(makeTxStub({ fee: "9999", hashHex: "0002" }));

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("rejects when time bounds are altered", () => {
    fromXDR
      .mockReturnValueOnce(
        makeTxStub({ timeBounds: { minTime: "0", maxTime: "1000" }, hashHex: "0001" }),
      )
      .mockReturnValueOnce(
        makeTxStub({ timeBounds: { minTime: "0", maxTime: "9999" }, hashHex: "0002" }),
      );

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("rejects when an operation is removed", () => {
    fromXDR
      .mockReturnValueOnce(
        makeTxStub({
          operations: [
            { type: "invokeHostFunction", func: { toXDR: () => "f==" } },
          ],
          hashHex: "0001",
        }),
      )
      .mockReturnValueOnce(makeTxStub({ operations: [], hashHex: "0002" }));

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("rejects when the contract function or arguments are altered", () => {
    fromXDR
      .mockReturnValueOnce(
        makeTxStub({
          operations: [
            { type: "invokeHostFunction", func: { toXDR: () => "original-func==" } },
          ],
          hashHex: "0001",
        }),
      )
      .mockReturnValueOnce(
        makeTxStub({
          operations: [
            { type: "invokeHostFunction", func: { toXDR: () => "tampered-func==" } },
          ],
          hashHex: "0002",
        }),
      );

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).toThrow(XdrMismatchError);
  });

  it("includes the altered field name in the error", () => {
    fromXDR
      .mockReturnValueOnce(makeTxStub({ source: "GABC", hashHex: "0001" }))
      .mockReturnValueOnce(makeTxStub({ source: "GXYZ", hashHex: "0002" }));

    let err: XdrMismatchError | undefined;
    try {
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET);
    } catch (e) {
      err = e as XdrMismatchError;
    }
    expect(err).toBeInstanceOf(XdrMismatchError);
    expect(err?.field).toBe("source account");
  });

  it("skips verification gracefully when fromXDR returns a stub without hash()", () => {
    // Simulates the existing test mock that returns { _mockTx: true }
    fromXDR.mockReturnValue({ _mockTx: true });

    expect(() =>
      verifySignedXdrInvariants("prep-xdr", "signed-xdr", TESTNET),
    ).not.toThrow();
  });
});

describe("signAndSubmitTransaction — XDR invariant integration (#993)", () => {
  let fromXDR: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromXDR = vi.mocked(TransactionBuilder.fromXDR);
  });

  it("returns errorKind 'xdr_mismatch' when the wallet alters the source account", async () => {
    freighter.signTransaction.mockResolvedValue(VALID_XDR);

    // First two fromXDR calls go to verifySignedXdrInvariants;
    // they return different source accounts so the check fails.
    fromXDR
      .mockReturnValueOnce(makeTxStub({ source: "GAAA", hashHex: "0001" })) // prepared
      .mockReturnValueOnce(makeTxStub({ source: "GBBB", hashHex: "0002" })); // signed (attacker)

    const result = await txModule.signAndSubmitTransaction(VALID_XDR, { intervalMs: 1 });

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("xdr_mismatch");
    expect(result.error).toMatch(/source account/);
  });
});

describe("stellarTransactions — network mismatch (issue #807)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_STELLAR_ENV", "mainnet");
    vi.stubEnv("NEXT_PUBLIC_NETWORK_PASSPHRASE", MAINNET);
  });

  it("signTransaction throws NetworkMismatchError when the wallet is on another network", async () => {
    freighter.getNetworkDetails.mockResolvedValue({ networkPassphrase: TESTNET });
    await expect(txModule.signTransaction(VALID_XDR)).rejects.toBeInstanceOf(
      NetworkMismatchError,
    );
    expect(freighter.signTransaction).not.toHaveBeenCalled();
  });

  it("signAndSubmitTransaction returns errorKind 'mismatch'", async () => {
    freighter.getNetworkDetails.mockResolvedValue({ network: "TESTNET" });
    const result = await txModule.signAndSubmitTransaction(VALID_XDR);
    expect(result).toMatchObject({ success: false, errorKind: "mismatch" });
  });
});
