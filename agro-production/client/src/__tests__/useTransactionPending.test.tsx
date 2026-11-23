import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(),
}));

vi.mock("@/lib/transactionRecovery", () => ({
  reconcilePendingTransactions: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/errorHandling", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errorHandling")>();
  return {
    ...actual,
    classifyError: vi.fn((err: string | Error) => ({
      category: "unknown",
      actionableMessage: typeof err === "string" ? err : err?.message || "An error occurred",
    })),
  };
});

import { useTransaction } from "@/hooks/useTransaction";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import {
  clearPendingTransactions,
  recordSubmittedTransaction,
} from "@/lib/pendingTransactions";

const mockSign = vi.mocked(signAndSubmitTransaction);
const intent = "order:p1:2:GBUYER";

describe("useTransaction pending handling (Issue #1371)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingTransactions();
    globalThis.localStorage?.removeItem("agro:last-tx-intent");
  });

  it("treats a submitted-but-pending transaction as busy and blocks a duplicate attempt", async () => {
    mockSign.mockResolvedValue({
      success: false,
      outcome: "pending",
      txHash: "a".repeat(64),
      status: "PENDING",
    });

    const { result } = renderHook(() => useTransaction());
    const buildXdr = vi.fn().mockResolvedValue("xdr");

    await act(async () => {
      await result.current.execute(buildXdr, { intent });
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.isBusy).toBe(true);
    expect(result.current.isUnconfirmed).toBe(true);

    recordSubmittedTransaction({ intent, hash: "a".repeat(64), timeoutSeconds: 30 });

    await act(async () => {
      await result.current.execute(buildXdr, { intent });
    });

    expect(buildXdr).toHaveBeenCalledTimes(1);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("pending");
  });

  it("restores pending state after a remount while an intent is in flight", async () => {
    recordSubmittedTransaction({ intent, hash: "b".repeat(64), timeoutSeconds: 30 });
    globalThis.localStorage?.setItem("agro:last-tx-intent", intent);

    const { result } = renderHook(() => useTransaction());

    await act(async () => {});

    expect(result.current.status).toBe("pending");
    expect(result.current.txHash).toBe("b".repeat(64));
    expect(result.current.isPending).toBe(true);
    expect(mockSign).not.toHaveBeenCalled();
  });
});
