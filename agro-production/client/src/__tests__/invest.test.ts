import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useInvest } from "@/hooks/useInvest";
import * as investService from "@/lib/investService";
import * as contractService from "@/lib/contractService";
import * as signTransaction from "@/lib/signTransaction";

vi.mock("@/lib/investService", () => ({
  recordInvestment: vi.fn(),
}));

vi.mock("@/lib/contractService", () => ({
  buildInvestTransaction: vi.fn(),
}));

vi.mock("@/lib/signTransaction", () => ({
  signAndSubmitTransaction: vi.fn(),
}));

vi.mock("@/lib/errorHandling", () => ({
  classifyError: vi.fn((err: unknown, action: string) => ({
    category: "TEST_ERROR",
    actionableMessage: err instanceof Error ? err.message : String(err),
  })),
  logErrorWithContext: vi.fn(),
}));

describe("useInvest state machine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should complete the full investment flow", async () => {
    const { result } = renderHook(() => useInvest());

    vi.mocked(contractService.buildInvestTransaction).mockResolvedValue({
      success: true,
      data: "mock-xdr",
    });

    vi.mocked(signTransaction.signAndSubmitTransaction).mockResolvedValue({
      success: true,
      txHash: "mock-tx-hash",
    });

    vi.mocked(investService.recordInvestment).mockResolvedValue(undefined);

    expect(result.current.machine.phase).toBe("idle");

    act(() => {
      void result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
    });

    await waitFor(() => {
      expect(result.current.machine.phase).toBe("success");
    });

    expect(result.current.machine.steps.build).toBe("done");
    expect(result.current.machine.steps.sign).toBe("done");
    expect(result.current.machine.steps.submit).toBe("done");
    expect(result.current.machine.steps.confirm).toBe("done");
    expect(result.current.machine.steps.refresh).toBe("done");

    expect(contractService.buildInvestTransaction).toHaveBeenCalledWith("GBMOCK", "C_ONCHAIN", 100n);
    expect(signTransaction.signAndSubmitTransaction).toHaveBeenCalledWith("mock-xdr");
    expect(investService.recordInvestment).toHaveBeenCalledWith("camp1", "GBMOCK", 100n);
  });

  it("should fail if transaction building fails (failed simulation)", async () => {
    const { result } = renderHook(() => useInvest());

    vi.mocked(contractService.buildInvestTransaction).mockResolvedValue({
      success: false,
      error: "Simulation failed",
    });

    act(() => {
      void result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
    });

    await waitFor(() => {
      expect(result.current.machine.phase).toBe("failed");
    });

    expect(result.current.machine.error).toBe("Simulation failed");
    expect(result.current.machine.steps.build).toBe("error");
    expect(signTransaction.signAndSubmitTransaction).not.toHaveBeenCalled();
  });

  it("should fail if user rejects signature (rejection)", async () => {
    const { result } = renderHook(() => useInvest());

    vi.mocked(contractService.buildInvestTransaction).mockResolvedValue({
      success: true,
      data: "mock-xdr",
    });

    vi.mocked(signTransaction.signAndSubmitTransaction).mockResolvedValue({
      success: false,
      error: "User rejected signature",
    });

    act(() => {
      void result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
    });

    await waitFor(() => {
      expect(result.current.machine.phase).toBe("failed");
    });

    expect(result.current.machine.error).toBe("User rejected signature");
    expect(result.current.machine.steps.build).toBe("done");
    expect(result.current.machine.steps.submit).toBe("error");
  });

  it("should fail if signing or submission fails with timeout", async () => {
    const { result } = renderHook(() => useInvest());

    vi.mocked(contractService.buildInvestTransaction).mockResolvedValue({
      success: true,
      data: "mock-xdr",
    });

    vi.mocked(signTransaction.signAndSubmitTransaction).mockResolvedValue({
      success: false,
      error: "Timeout waiting for signature",
    });

    act(() => {
      void result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
    });

    await waitFor(() => {
      expect(result.current.machine.phase).toBe("failed");
    });

    expect(result.current.machine.error).toBe("Timeout waiting for signature");
    expect(result.current.machine.steps.build).toBe("done");
    expect(result.current.machine.steps.submit).toBe("error");
  });

  it("should prevent duplicate submission", async () => {
    const { result } = renderHook(() => useInvest());

    vi.mocked(contractService.buildInvestTransaction).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: "xdr" }), 100))
    );

    let error: unknown;
    await act(async () => {
      const first = result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
      try {
        await result.current.invest("camp1", "C_ONCHAIN", "GBMOCK", 100n);
      } catch (e) {
        error = e;
      }
      await first;
    });

    expect(error).toBeDefined();
    expect((error as Error).message).toBe("Duplicate submission");
  });
});
