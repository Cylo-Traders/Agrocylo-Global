import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/errorHandling", () => ({
  classifyError: vi.fn((err) => ({
    category: "unknown",
    actionableMessage: err?.message || "An error occurred",
  })),
  logErrorWithContext: vi.fn(),
}));

import { useTransaction } from "@/hooks/useTransaction";
import { buildCreateOrder } from "@/lib/contractService";
import { createOrder } from "@/services/orderService";
import { signAndSubmitTransaction } from "@/lib/signTransaction";
import { logErrorWithContext } from "@/lib/errorHandling";

const mockBuildCreateOrder = vi.mocked(buildCreateOrder);
const mockCreateOrder = vi.mocked(createOrder);
const mockSignAndSubmit = vi.mocked(signAndSubmitTransaction);
const mockLogErrorWithContext = vi.mocked(logErrorWithContext);

describe("Product checkout error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builder failure surfaces in error UI", async () => {
    mockCreateOrder.mockResolvedValue({ id: "order-123" } as any);
    mockBuildCreateOrder.mockResolvedValue({
      success: false,
      error: "Contract not initialized",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      const order = await mockCreateOrder({
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
    mockCreateOrder.mockResolvedValue({ id: "order-456" } as any);
    mockBuildCreateOrder.mockResolvedValue({
      success: true,
      data: "prepared-xdr",
    });
    mockSignAndSubmit.mockResolvedValue({
      success: false,
      error: "Transaction rejected by wallet",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      const order = await mockCreateOrder({
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
    mockCreateOrder.mockResolvedValue({ id: createdOrderId } as any);
    mockBuildCreateOrder.mockResolvedValue({
      success: true,
      data: "prepared-xdr",
    });
    mockSignAndSubmit.mockResolvedValue({
      success: true,
      txHash: "a".repeat(64),
      status: "SUCCESS",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      const order = await mockCreateOrder({
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
    mockCreateOrder.mockResolvedValue({ id: "order-err" } as any);
    mockBuildCreateOrder.mockResolvedValue({
      success: false,
      error: "RPC error",
    });

    const { result } = renderHook(() => useTransaction());

    const builderFn = async () => {
      const order = await mockCreateOrder({
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
});
