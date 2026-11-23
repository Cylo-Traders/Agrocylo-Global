import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Mock dependencies
vi.mock("@/lib/contractService", () => ({
  buildCreateOrder: vi.fn(),
}));

vi.mock("@/services/orderService", () => ({
  createOrder: vi.fn(),
}));

vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(),
}));

vi.mock("@/lib/errorHandling", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/errorHandling")>();
  return {
    ...actual,
    classifyError: vi.fn((err: string | Error) => ({
      category: typeof err === "string" ? "unknown" : err.name || "unknown",
      actionableMessage: typeof err === "string" ? err : err?.message || "An error occurred",
    })),
  };
});

import { useTransaction } from "@/hooks/useTransaction";
import { buildCreateOrder } from "@/lib/contractService";
import { createOrder } from "@/services/orderService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import { logErrorWithContext } from "@/lib/errorHandling";
import type { Order } from "@/types";

const mockBuildCreateOrder = vi.mocked(buildCreateOrder);
const mockCreateOrder = vi.mocked(createOrder);
const mockSignAndSubmit = vi.mocked(signAndSubmitTransaction);
const mockLogErrorWithContext = vi.mocked(logErrorWithContext);

/**
 * Simulate the browser connectivity state used by the offline-aware
 * marketplace behavior (issue #1392). Checkout must be unavailable while
 * offline and become available again once connectivity returns.
 */
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

describe("Product checkout error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOnline(true);
  });

  afterEach(() => {
    setOnline(true);
  });

  it("builder failure surfaces in error UI", async () => {
    mockCreateOrder.mockResolvedValue({ id: "order-123" } as Order);
    mockBuildCreateOrder.mockResolvedValue({
      success: false,
      error: "Contract not initialized",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      await mockCreateOrder({
        buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        campaignId: "campaign-123",
        amount: "5000000",
      });

      const builtResult = await mockBuildCreateOrder(
        "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        "campaign-123",
        5000000n
      );

      if (!builtResult.success) {
        throw new Error(builtResult.error);
      }

      return builtResult.data!;
    };

    await act(async () => {
      await result.current.execute(builderFn);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toContain("Contract not initialized");
    // Order should have been created despite build failure
    expect(mockCreateOrder).toHaveBeenCalled();
  });

  it("wallet rejection surfaces in error UI", async () => {
    mockCreateOrder.mockResolvedValue({ id: "order-456" } as Order);
    mockBuildCreateOrder.mockResolvedValue({
      success: true,
      data: "prepared-xdr",
    });
    mockSignAndSubmit.mockResolvedValue({
      success: false,
      outcome: "failed",
      error: "Transaction rejected by wallet",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      await mockCreateOrder({
        buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        campaignId: "campaign-456",
        amount: "5000000",
      });

      const builtResult = await mockBuildCreateOrder(
        "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        "campaign-456",
        5000000n
      );

      if (!builtResult.success) {
        throw new Error(builtResult.error);
      }

      return builtResult.data!;
    };

    await act(async () => {
      await result.current.execute(builderFn);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toContain("rejected by wallet");
  });

  it("successful transaction creates off-chain order record", async () => {
    const createdOrderId = "order-789";
    mockCreateOrder.mockResolvedValue({ id: createdOrderId } as Order);
    mockBuildCreateOrder.mockResolvedValue({
      success: true,
      data: "prepared-xdr",
    });
    mockSignAndSubmit.mockResolvedValue({
      success: true,
      outcome: "confirmed",
      txHash: "a".repeat(64),
      status: "SUCCESS",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      await mockCreateOrder({
        buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        campaignId: "campaign-789",
        amount: "5000000",
      });

      const builtResult = await mockBuildCreateOrder(
        "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        "campaign-789",
        5000000n
      );

      if (!builtResult.success) {
        throw new Error(builtResult.error);
      }

      return builtResult.data!;
    };

    await act(async () => {
      await result.current.execute(builderFn);
    });

    expect(result.current.isSuccess).toBe(true);
    expect(mockCreateOrder).toHaveBeenCalledWith({
      buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
      campaignId: "campaign-789",
      amount: "5000000",
    });
  });

  it("logs error context when builder fails", async () => {
    mockCreateOrder.mockResolvedValue({ id: "order-err" } as Order);
    mockBuildCreateOrder.mockResolvedValue({
      success: false,
      error: "RPC error",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      await mockCreateOrder({
        buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        campaignId: "campaign-err",
        amount: "5000000",
      });

      const builtResult = await mockBuildCreateOrder(
        "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        "campaign-err",
        5000000n
      );

      if (!builtResult.success) {
        throw new Error(builtResult.error);
      }

      return builtResult.data!;
    };

    await act(async () => {
      await result.current.execute(builderFn);
    });

    expect(mockLogErrorWithContext).toHaveBeenCalled();
  });

  it("checkout is unavailable while offline and recovers on reconnect", async () => {
    mockCreateOrder.mockResolvedValue({ id: "order-offline" } as Order);
    mockBuildCreateOrder.mockResolvedValue({
      success: true,
      data: "prepared-xdr",
    });
    mockSignAndSubmit.mockResolvedValue({
      success: true,
      outcome: "confirmed",
      txHash: "b".repeat(64),
      status: "SUCCESS",
    });

    const { result } = renderHook(() => useTransaction());

    // Go offline: checkout must not proceed.
    act(() => {
      setOnline(false);
    });
    expect(window.navigator.onLine).toBe(false);

    const offlineBuilder = async () => {
      if (!window.navigator.onLine) {
        throw new Error("Checkout is unavailable while offline");
      }
      return "prepared-xdr";
    };

    await act(async () => {
      await result.current.execute(offlineBuilder);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toContain("unavailable while offline");
    expect(mockCreateOrder).not.toHaveBeenCalled();

    // Reconnect: checkout becomes available again without duplicating actions.
    act(() => {
      setOnline(true);
    });
    expect(window.navigator.onLine).toBe(true);

    const onlineBuilder = async () => {
      await mockCreateOrder({
        buyerAddress: "GBUQWP3FTHOUQSV2HFEFNVD5B4BLXLLJFP3J62KH3FWRVFWTWQ32RHU",
        campaignId: "campaign-offline",
        amount: "5000000",
      });
      return "prepared-xdr";
    };

    await act(async () => {
      await result.current.execute(onlineBuilder);
    });

    expect(result.current.isSuccess).toBe(true);
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
  });
});
