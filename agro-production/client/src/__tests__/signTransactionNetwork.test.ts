import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPECTED_NETWORK_PASSPHRASE,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  networkName,
} from "@/lib/stellarNetwork";

/**
 * Signing must fail closed on an unverifiable or wrong wallet network (#1087).
 *
 * The registry is mocked so the freighter/stellar-wallets-kit import chain
 * never loads, and stellar-sdk's Server is stubbed so the happy path can run
 * without touching the network.
 */

const sdkMocks = vi.hoisted(() => ({
  fromXDR: vi.fn(),
  sendTransaction: vi.fn(),
  getTransaction: vi.fn(),
}));

const walletMocks = vi.hoisted(() => ({
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    TransactionBuilder: { fromXDR: sdkMocks.fromXDR },
    rpc: {
      ...actual.rpc,
      Server: class Server {
        sendTransaction = sdkMocks.sendTransaction;
        getTransaction = sdkMocks.getTransaction;
      },
    },
  };
});

vi.mock("@/lib/wallets/registry", () => ({
  DEFAULT_WALLET_ID: "freighter",
  getWalletAdapter: () => ({
    id: "freighter",
    name: "Freighter",
    getNetwork: walletMocks.getNetwork,
    signTransaction: walletMocks.signTransaction,
  }),
}));

import { signAndSubmitTransaction } from "@/lib/signTransaction";

const WRONG_PASSPHRASE =
  EXPECTED_NETWORK_PASSPHRASE === MAINNET_PASSPHRASE
    ? TESTNET_PASSPHRASE
    : MAINNET_PASSPHRASE;

describe("signAndSubmitTransaction network verification (#1087)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("refuses to sign when the wallet reports no network", async () => {
    walletMocks.getNetwork.mockResolvedValue(null);
    const onStage = vi.fn();

    const result = await signAndSubmitTransaction("XDR", onStage);

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("did not report a network passphrase");
    expect(walletMocks.signTransaction).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("refuses to sign when getNetwork throws", async () => {
    walletMocks.getNetwork.mockRejectedValue(new Error("no wallet"));

    const result = await signAndSubmitTransaction("XDR");

    expect(result.success).toBe(false);
    expect(result.error).toContain("did not report a network passphrase");
    expect(walletMocks.signTransaction).not.toHaveBeenCalled();
  });

  it("refuses to sign on a known wrong network and names both networks", async () => {
    walletMocks.getNetwork.mockResolvedValue({
      networkPassphrase: WRONG_PASSPHRASE,
    });
    const onStage = vi.fn();

    const result = await signAndSubmitTransaction("XDR", onStage);

    expect(result.success).toBe(false);
    expect(result.outcome).toBe("failed");
    expect(result.error).toContain("Network mismatch");
    expect(result.error).toContain(networkName(EXPECTED_NETWORK_PASSPHRASE));
    expect(result.error).toContain(networkName(WRONG_PASSPHRASE));
    expect(walletMocks.signTransaction).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalled();
  });

  it("signs and submits when the wallet reports the configured network", async () => {
    walletMocks.getNetwork.mockResolvedValue({
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });
    walletMocks.signTransaction.mockResolvedValue("signed-xdr");
    sdkMocks.fromXDR.mockReturnValue({ fake: "tx" });
    sdkMocks.sendTransaction.mockResolvedValue({
      status: "PENDING",
      hash: "deadbeef",
    });
    sdkMocks.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    const stages: string[] = [];

    const result = await signAndSubmitTransaction("XDR", (stage) =>
      stages.push(stage),
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("confirmed");
    expect(result.txHash).toBe("deadbeef");
    expect(walletMocks.signTransaction).toHaveBeenCalledWith("XDR", {
      networkPassphrase: EXPECTED_NETWORK_PASSPHRASE,
    });
    expect(stages).toEqual(["signing", "submitting", "confirming"]);
  });
});
