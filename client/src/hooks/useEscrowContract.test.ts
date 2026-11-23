import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEscrowContract } from "./useEscrowContract";
import { WalletContext } from "@/context/WalletContext";
import type { WalletContextType } from "@/types/wallet";
import React from "react";

const mockSignAndSubmit = vi.fn();
const mockWallet: WalletContextType = {
  address: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
  balance: "100",
  connected: true,
  loading: false,
  restoring: false,
  error: null,
  network: "TESTNET",
  networkMismatch: false,
  activeWalletId: "freighter",
  connect: vi.fn(),
  disconnect: vi.fn(),
  refreshBalance: vi.fn(),
  signAndSubmit: mockSignAndSubmit,
};

vi.mock("@/services/stellar/contractService", () => ({
  confirmReceipt: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: "AAAA...",
      error: null,
    }),
  ),
  refundExpiredOrder: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: "BBBB...",
      error: null,
    }),
  ),
  openDispute: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: "CCCC...",
      error: null,
    }),
  ),
  createOrder: vi.fn(() =>
    Promise.resolve({ success: true, data: "DDDD...", error: null }),
  ),
  resolveDispute: vi.fn(() =>
    Promise.resolve({ success: true, data: "EEEE...", error: null }),
  ),
  resolveSplitDispute: vi.fn(() =>
    Promise.resolve({ success: true, data: "FFFF...", error: null }),
  ),
  getOrderDetails: vi.fn(),
}));

vi.mock("@/lib/testMode", () => ({
  isTestMode: vi.fn(() => false),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    WalletContext.Provider,
    { value: mockWallet },
    children,
  );
}

describe("useEscrowContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignAndSubmit.mockResolvedValue({
      success: true,
      txHash: "TX_HASH_123",
    });
  });

  it("exposes the unified tx API with confirm/refund/dispute methods", () => {
    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    expect(result.current.tx.confirm).toBeInstanceOf(Function);
    expect(result.current.tx.refund).toBeInstanceOf(Function);
    expect(result.current.tx.dispute).toBeInstanceOf(Function);
    expect(result.current.tx.isLoading).toBe(false);
    expect(result.current.tx.error).toBeNull();
    expect(result.current.tx.blockchainError).toBeNull();
    expect(result.current.tx.activeAction).toBeNull();
  });

  it("sets isLoading during confirm and clears it afterward", async () => {
    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.tx.confirm("order-1");
    });

    expect(result.current.tx.isLoading).toBe(true);
    expect(result.current.tx.activeAction).toBe("confirm");

    await act(async () => {
      await promise;
    });

    expect(result.current.tx.isLoading).toBe(false);
    expect(result.current.tx.activeAction).toBeNull();
  });

  it("classifies insufficient_balance error with structured info", async () => {
    mockSignAndSubmit.mockRejectedValue(new Error("insufficient funds"));

    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    await act(async () => {
      try {
        await result.current.tx.confirm("order-1");
      } catch {
        // expected
      }
    });

    expect(result.current.tx.error).toBe("insufficient funds");
    expect(result.current.tx.blockchainError).not.toBeNull();
    expect(result.current.tx.blockchainError!.kind).toBe("insufficient_balance");
    expect(result.current.tx.blockchainError!.title).toBe("Insufficient Balance");
    expect(result.current.tx.blockchainError!.action).toContain("Check wallet balance");
  });

  it("classifies user_rejected error with structured info", async () => {
    mockSignAndSubmit.mockRejectedValue(new Error("User rejected the transaction"));

    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    await act(async () => {
      try {
        await result.current.tx.confirm("order-1");
      } catch {
        // expected
      }
    });

    expect(result.current.tx.blockchainError!.kind).toBe("user_rejected");
    expect(result.current.tx.blockchainError!.title).toBe("Transaction Rejected");
  });

  it("classifies network timeout with structured info", async () => {
    mockSignAndSubmit.mockRejectedValue(new Error("network timeout"));

    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    await act(async () => {
      try {
        await result.current.tx.refund("order-1");
      } catch {
        // expected
      }
    });

    expect(result.current.tx.blockchainError!.kind).toBe("network_unavailable");
    expect(result.current.tx.blockchainError!.title).toBe("Network Unavailable");
  });

  it("sets isLoading during refund and clears it afterward", async () => {
    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.tx.refund("order-1");
    });

    expect(result.current.tx.isLoading).toBe(true);
    expect(result.current.tx.activeAction).toBe("refund");

    await act(async () => {
      await promise;
    });

    expect(result.current.tx.isLoading).toBe(false);
    expect(result.current.tx.activeAction).toBeNull();
  });

  it("sets isLoading during dispute and clears it afterward", async () => {
    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    let promise: Promise<unknown>;
    act(() => {
      promise = result.current.tx.dispute("order-1", "reason", "evidence");
    });

    expect(result.current.tx.isLoading).toBe(true);
    expect(result.current.tx.activeAction).toBe("dispute");

    await act(async () => {
      await promise;
    });

    expect(result.current.tx.isLoading).toBe(false);
    expect(result.current.tx.activeAction).toBeNull();
  });

  it("clears error via clearError", async () => {
    mockSignAndSubmit.mockRejectedValue(new Error("Some error"));

    const { result } = renderHook(() => useEscrowContract(), { wrapper });

    await act(async () => {
      try {
        await result.current.tx.confirm("order-1");
      } catch {
        // expected
      }
    });

    expect(result.current.tx.error).toBe("Some error");

    act(() => {
      result.current.tx.clearError();
    });

    expect(result.current.tx.error).toBeNull();
    expect(result.current.tx.blockchainError).toBeNull();
  });

  // Issue #809 — every call site must surface a typed error from the single
  // consolidated transaction module, not just confirm/refund/dispute.
  describe("all six call sites surface typed errors", () => {
    const invoke = (
      api: ReturnType<typeof useEscrowContract>,
      name: string,
    ): Promise<unknown> => {
      switch (name) {
        case "create":
          return api.createOrder("FARMER", "TOKEN", 1n, "2030-01-01T00:00:00Z");
        case "confirm":
          return api.confirmReceipt("order-1");
        case "dispute":
          return api.openDispute("order-1", "reason", "evidence");
        case "resolve":
          return api.resolveDispute("order-1", { tag: "Refund" });
        case "split":
          return api.resolveSplitDispute("order-1", 1n, 1n);
        case "refund":
          return api.requestRefund("order-1");
        default:
          throw new Error(`unknown action ${name}`);
      }
    };

    it.each(["create", "confirm", "dispute", "resolve", "split", "refund"])(
      "%s surfaces a network-timeout typed error",
      async (action) => {
        // A failure result from the consolidated module (errorKind: "timeout").
        mockSignAndSubmit.mockResolvedValue({
          success: false,
          txHash: "TX_HASH_X",
          status: "TIMEOUT",
          error: "Transaction TX_HASH_X was not confirmed within 30s",
          errorKind: "timeout",
        });

        const { result } = renderHook(() => useEscrowContract(), { wrapper });

        let caught: unknown;
        await act(async () => {
          try {
            await invoke(result.current, action);
          } catch (e) {
            caught = e;
          }
        });

        expect(caught).toBeInstanceOf(Error);
        const state = {
          create: () => result.current.createState,
          confirm: () => result.current.confirmState,
          dispute: () => result.current.disputeState,
          resolve: () => result.current.resolveState,
          split: () => result.current.splitState,
          refund: () => result.current.refundState,
        }[action]!();
        expect(state.error).toMatch(/not confirmed within/i);
        expect(state.blockchainError).not.toBeNull();
      },
    );
  });
});
