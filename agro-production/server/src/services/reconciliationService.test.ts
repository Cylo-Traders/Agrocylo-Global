import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSimulateTransaction } = vi.hoisted(() => ({
  mockSimulateTransaction: vi.fn(),
}));

const mockServerInstance = {
  simulateTransaction: mockSimulateTransaction,
  getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
};

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    constructor() {
      return mockServerInstance;
    }
  }
  class MockContract {
    constructor(_id: string) {}
    call(..._args: unknown[]) {
      return {};
    }
  }
  class MockTransactionBuilder {
    constructor(_account: unknown, _opts: unknown) {}
    addOperation(_op: unknown) { return this; }
    setTimeout(_t: unknown) { return this; }
    build() { return {}; }
  }
  return {
    rpc: { Server: MockServer },
    Account: vi.fn(),
    Contract: MockContract,
    nativeToScVal: vi.fn((val: unknown) => ({ type: "u64", value: val })),
    scValToNative: vi.fn(),
    TransactionBuilder: MockTransactionBuilder,
    xdr: {},
  };
});

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config/index.js", () => ({
  config: {
    contractId: "CTEST000000000000000000000000000000000000000000000000AA",
    productionEscrowContractId: "CTEST000000000000000000000000000000000000000000000000AA",
    basketContractId: "CTEST000000000000000000000000000000000000000000000000BB",
    rpcUrl: "https://soroban-testnet.stellar.org",
    nodeEnv: "development",
  },
}));

vi.mock("../db/client.js", () => ({
  prisma: {
    campaign: { findMany: vi.fn(), findUnique: vi.fn() },
    order: { findMany: vi.fn() },
    dispute: { findFirst: vi.fn() },
    basket: { findMany: vi.fn() },
    reconciliationAlert: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
  },
}));

import { runProductionReconciliation, reconcileSingleCampaign } from "./reconciliationService.js";
import { prisma } from "../db/client.js";
import { scValToNative } from "@stellar/stellar-sdk";

describe("productionReconciliationService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("runProductionReconciliation", () => {
    it("checks active campaigns against chain", async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        {
          id: "1",
          onChainId: "10",
          farmerAddress: "FARMER",
          tokenAddress: "USDC",
          targetAmount: "50000",
          totalRaised: "25000",
          totalRevenue: "0",
          trancheReleased: "0",
          imageUrl: null,
          deadline: new Date(),
          status: "FUNDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.basket.findMany).mockResolvedValue([]);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative).mockReturnValue({
        id: 10,
        farmer: "FARMER",
        token: "USDC",
        target_amount: "50000",
        total_raised: "25000",
        total_revenue: "0",
        tranche_released: "0",
        deadline: 1700000000,
        created_at: 1700000000,
        status: 0, // Funding
        current_milestone: 0,
      });

      const report = await runProductionReconciliation();

      expect(report.campaignsChecked).toBeGreaterThanOrEqual(1);
    });

    it("detects campaign status drift", async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        {
          id: "1",
          onChainId: "10",
          farmerAddress: "FARMER",
          tokenAddress: "USDC",
          targetAmount: "50000",
          totalRaised: "25000",
          totalRevenue: "0",
          trancheReleased: "0",
          imageUrl: null,
          deadline: new Date(),
          status: "FUNDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.basket.findMany).mockResolvedValue([]);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      // Chain says Funded (1), DB says FUNDING
      vi.mocked(scValToNative).mockReturnValue({
        id: 10,
        farmer: "FARMER",
        token: "USDC",
        target_amount: "50000",
        total_raised: "50000",
        total_revenue: "0",
        tranche_released: "0",
        deadline: 1700000000,
        created_at: 1700000000,
        status: 1, // Funded
        current_milestone: 0,
      });

      const report = await runProductionReconciliation();

      expect(report.driftsFound).toBeGreaterThanOrEqual(1);
      const statusDrift = report.alerts.find((a) => a.driftType === "status_mismatch");
      expect(statusDrift).toBeDefined();
      expect(statusDrift?.dbValue).toEqual({ status: "FUNDING" });
      expect(statusDrift?.chainValue).toEqual({ status: "Funded" });
    });

    it("detects campaign amount drift (totalRaised)", async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        {
          id: "1",
          onChainId: "10",
          farmerAddress: "FARMER",
          tokenAddress: "USDC",
          targetAmount: "50000",
          totalRaised: "25000",
          totalRevenue: "0",
          trancheReleased: "0",
          imageUrl: null,
          deadline: new Date(),
          status: "FUNDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.basket.findMany).mockResolvedValue([]);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative).mockReturnValue({
        id: 10,
        farmer: "FARMER",
        token: "USDC",
        target_amount: "50000",
        total_raised: "30000", // Different from DB's 25000
        total_revenue: "0",
        tranche_released: "0",
        deadline: 1700000000,
        created_at: 1700000000,
        status: 0,
        current_milestone: 0,
      });

      const report = await runProductionReconciliation();

      const amountDrift = report.alerts.find(
        (a) => a.driftType === "amount_mismatch" && a.entityType === "campaign",
      );
      expect(amountDrift).toBeDefined();
      expect(amountDrift?.dbValue).toEqual({ totalRaised: "25000" });
      expect(amountDrift?.chainValue).toEqual({ totalRaised: "30000" });
    });

    it("persists alerts when drift found", async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        {
          id: "1",
          onChainId: "10",
          farmerAddress: "FARMER",
          tokenAddress: "USDC",
          targetAmount: "50000",
          totalRaised: "25000",
          totalRevenue: "0",
          trancheReleased: "0",
          imageUrl: null,
          deadline: new Date(),
          status: "FUNDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.basket.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reconciliationAlert.create).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative).mockReturnValue({
        id: 10,
        status: 1, // Funded, but DB says FUNDING
        total_raised: "25000",
        tranche_released: "0",
      });

      await runProductionReconciliation();

      expect(prisma.reconciliationAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "campaign",
          entityId: "10",
          driftType: "status_mismatch",
        }),
      });
    });
  });

  describe("reconcileSingleCampaign", () => {
    it("throws when campaign not found in DB", async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);

      await expect(reconcileSingleCampaign("999")).rejects.toThrow("not found");
    });

    it("returns no findings when chain matches DB", async () => {
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: "1",
        onChainId: "10",
        farmerAddress: "FARMER",
        tokenAddress: "USDC",
        targetAmount: "50000",
        totalRaised: "25000",
        totalRevenue: "0",
        trancheReleased: "0",
        imageUrl: null,
        deadline: new Date(),
        status: "FUNDING",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative).mockReturnValue({
        id: 10,
        status: 0, // Funding
        total_raised: "25000",
        tranche_released: "0",
      });

      const findings = await reconcileSingleCampaign("10");

      expect(findings).toHaveLength(0);
    });
  });
});
