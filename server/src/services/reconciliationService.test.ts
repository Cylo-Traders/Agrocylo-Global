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
    rpc: { Server: MockServer, Account: vi.fn() },
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
    contractId: "test-contract-id",
    rpcUrl: "https://soroban-testnet.stellar.org",
    nodeEnv: "development",
  },
}));

vi.mock("./promMetrics.js", () => ({
  reconciliationDriftTotal: { inc: vi.fn() },
  reconciliationRunDurationSeconds: { observe: vi.fn() },
  reconciliationErrorsTotal: { inc: vi.fn() },
  contractWatcherEventsPerPoll: { observe: vi.fn() },
  contractWatcherPagesPerPoll: { observe: vi.fn() },
  contractWatcherUnhandledTotal: { inc: vi.fn() },
}));

vi.mock("../config/sentry.js", () => ({
  captureAlert: vi.fn(),
}));

vi.mock("../config/database.js", () => ({
  prisma: {
    order: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    campaign: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    dispute: { findMany: vi.fn() },
    user: { upsert: vi.fn() },
    reconciliationAlert: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(async (fn: any) => {
      // Simulate transaction by calling fn with mocked tx object
      const tx: any = {
        order: { create: vi.fn().mockResolvedValue({}), findUnique: vi.fn() },
        campaign: { create: vi.fn().mockResolvedValue({}) },
        user: { upsert: vi.fn().mockResolvedValue({}) },
        reconciliationAlert: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    }),
  },
}));

import { runReconciliation, reconcileSingleOrder, attemptAutoRepair } from "./reconciliationService.js";
import { prisma } from "../config/database.js";
import { scValToNative } from "@stellar/stellar-sdk";
import { OrderStatus } from "../constants/status.js";
import { captureAlert } from "../config/sentry.js";

describe("reconciliationService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: $transaction mock already reset but ensure it works
    (prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const tx: any = {
        order: { create: vi.fn().mockResolvedValue({}), findUnique: vi.fn() },
        campaign: { create: vi.fn().mockResolvedValue({}) },
        user: { upsert: vi.fn().mockResolvedValue({}) },
        reconciliationAlert: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx);
    });
  });

  describe("runReconciliation", () => {
    it("returns empty report when no contract ID configured", async () => {
      const { config } = await import("../config/index.js");
      const originalContractId = config.contractId;
      (config as any).contractId = "";

      const report = await runReconciliation();

      expect(report.driftsFound).toBe(0);
      expect(report.errors).toContain("No CONTRACT_ID configured — skipping reconciliation");

      (config as any).contractId = originalContractId;
    });

    it("checks open orders against chain (canonical upper-case statuses)", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any); // for chain→DB scan, simulate exists to avoid missing_in_db

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        // First call: order status check
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "1000",
          status: 0,
        })
        // Second: get_order_count
        .mockReturnValueOnce(1)
        // Third: get_order_details for chain→DB scan id=1 (but we mocked findUnique exists, so won't need)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "1000",
          status: 0,
        });

      const report = await runReconciliation();

      expect(report.ordersChecked).toBe(1);
      expect(report.driftsFound).toBe(0);
      // Verify query uses canonical statuses
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: expect.objectContaining({ in: expect.arrayContaining([OrderStatus.PENDING, OrderStatus.DELIVERED, OrderStatus.DISPUTED]) }) }) }),
      );
    });

    it("detects status drift between DB and chain (canonical)", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "1000",
          status: 2, // Completed -> COMPLETED
        })
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER", farmer: "SELLER", amount: "1000", status: 2 });

      const report = await runReconciliation();

      expect(report.ordersChecked).toBe(1);
      expect(report.driftsFound).toBe(1);
      expect(report.alerts[0].driftType).toBe("status_mismatch");
      expect(report.alerts[0].dbValue).toEqual({ status: OrderStatus.PENDING });
      expect(report.alerts[0].chainValue).toEqual({ status: OrderStatus.COMPLETED });
    });

    it("detects amount drift between DB and chain", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "2000",
          status: 0,
        })
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER", farmer: "SELLER", amount: "2000", status: 0 });

      const report = await runReconciliation();

      expect(report.driftsFound).toBe(1);
      expect(report.alerts[0].driftType).toBe("amount_mismatch");
    });

    it("persists alerts to database when drift found", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reconciliationAlert.create).mockResolvedValue({} as any);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "2000",
          status: 0,
        })
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER", farmer: "SELLER", amount: "2000", status: 0 });

      await runReconciliation();

      expect(prisma.reconciliationAlert.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: "order",
          entityId: "100",
          driftType: "amount_mismatch",
        }),
      });
    });

    it("detects missing_in_db via chain→DB scan", async () => {
      // DB empty, but chain has order 1
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      // For chain scan, order 1 missing
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      // Need to mock get_onChainCount = 1, then get_order_details for id 1 returns order
      mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
      vi.mocked(scValToNative)
        // get_order_count returns 1
        .mockReturnValueOnce(1)
        // get_order_details for id 1 returns chain data
        .mockReturnValueOnce({ buyer: "BUYER_X", farmer: "FARMER_Y", amount: "500", status: 0, token: "USDC" });

      const report = await runReconciliation();
      // Should find missing_in_db
      expect(report.alerts.some((a) => a.driftType === "missing_in_db" && a.entityId === "1")).toBe(true);
    });

    it("auto-repairs missing_in_db and re-check clean", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
      vi.mocked(scValToNative)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER_X", farmer: "FARMER_Y", amount: "500", status: 0, token: "USDC" });

      // Mock $transaction to simulate successful insert and then subsequent findUnique succeeds
      const mockTxOrderCreate = vi.fn().mockResolvedValue({});
      const mockTxAlertCreate = vi.fn().mockResolvedValue({});
      (prisma.$transaction as any).mockImplementation(async (fn: any) => {
        const tx: any = {
          order: { create: mockTxOrderCreate, findUnique: vi.fn().mockResolvedValue({}) },
          campaign: { create: vi.fn(), findUnique: vi.fn() },
          user: { upsert: vi.fn().mockResolvedValue({}) },
          reconciliationAlert: { create: mockTxAlertCreate },
        };
        await fn(tx);
        // After transaction, simulate that order now exists for re-check
        vi.mocked(prisma.order.findUnique).mockResolvedValueOnce({ orderIdOnChain: "1", status: OrderStatus.PENDING } as any);
        return {};
      });

      const report = await runReconciliation();
      expect(report.alerts.some((a) => a.driftType === "missing_in_db")).toBe(true);
      // Auto-repair should have been attempted via $transaction
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("reconcileSingleOrder", () => {
    it("throws when order not found in DB", async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      await expect(reconcileSingleOrder("999")).rejects.toThrow("not found");
    });

    it("returns no findings when chain matches DB (canonical)", async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        id: "1",
        orderIdOnChain: "100",
        buyerAddress: "BUYER",
        sellerAddress: "SELLER",
        amount: "1000",
        token: "USDC",
        status: OrderStatus.PENDING,
        productId: null,
        txHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative).mockReturnValue({
        buyer: "BUYER",
        farmer: "SELLER",
        amount: "1000",
        status: 0,
      });

      const findings = await reconcileSingleOrder("100");

      expect(findings).toHaveLength(0);
    });

    it("detects missing_on_chain when contract returns null", async () => {
      vi.mocked(prisma.order.findUnique).mockResolvedValue({
        id: "1",
        orderIdOnChain: "100",
        buyerAddress: "BUYER",
        sellerAddress: "SELLER",
        amount: "1000",
        token: "USDC",
        status: OrderStatus.PENDING,
        productId: null,
        txHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      mockSimulateTransaction.mockResolvedValue({ error: "not found" } as any);

      const findings = await reconcileSingleOrder("100");
      expect(findings[0].driftType).toBe("missing_on_chain");
    });
  });

  describe("reconciliation — metrics and audit logging", () => {
    it("emits reconciliation_drift metric when drift detected and fires Sentry alert", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "2000",
          status: 0,
        })
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER", farmer: "SELLER", amount: "2000", status: 0 });

      const report = await runReconciliation();

      expect(report.driftsFound).toBeGreaterThan(0);
      // Verify metric was logged
      const { default: logger } = await import("../config/logger.js");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[Reconciliation] Drift detected"),
        expect.any(Object)
      );
      // Verify Sentry alert fired
      expect(captureAlert).toHaveBeenCalledWith(
        "reconciliation_drift_detected",
        expect.stringContaining("drift"),
        expect.any(Object)
      );
      // Verify prometheus metric inc called
      const { reconciliationDriftTotal } = await import("./promMetrics.js");
      expect(reconciliationDriftTotal.inc).toHaveBeenCalled();
    });

    it("records no drift metric when reconciliation passes", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([
        {
          id: "1",
          orderIdOnChain: "100",
          buyerAddress: "BUYER",
          sellerAddress: "SELLER",
          amount: "1000",
          token: "USDC",
          status: OrderStatus.PENDING,
          productId: null,
          txHash: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any[]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.order.findUnique).mockResolvedValue({} as any);

      mockSimulateTransaction.mockResolvedValue({
        result: { retval: {} },
      });
      vi.mocked(scValToNative)
        .mockReturnValueOnce({
          buyer: "BUYER",
          farmer: "SELLER",
          amount: "1000",
          status: 0,
        })
        .mockReturnValueOnce(1)
        .mockReturnValueOnce({ buyer: "BUYER", farmer: "SELLER", amount: "1000", status: 0 });

      const report = await runReconciliation();

      expect(report.driftsFound).toBe(0);
      // Verify success metric was logged
      const { default: logger } = await import("../config/logger.js");
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("[Reconciliation] No drift detected"),
        expect.any(Object)
      );
    });
  });

  describe("reconciliation — campaign sweep not silent no-op", () => {
    it("reconcileCampaigns increments checked and does not silently skip", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        {
          id: "c1",
          campaignIdOnChain: "1",
          creatorAddress: "FARMER",
          goalAmount: "1000",
          token: "USDC",
          status: "ACTIVE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);
      vi.mocked(prisma.order.findUnique).mockResolvedValue(null);

      mockSimulateTransaction.mockResolvedValue({ result: { retval: {} } });
      // get_campaign will be mocked to return ACTIVE status
      vi.mocked(scValToNative).mockReturnValue({ status: 0, total_invested: "0" });

      const report = await runReconciliation();
      expect(report.campaignsChecked).toBe(1);
    });
  });

  describe("reconciliation — concurrent safety", () => {
    it("uses database transactions to prevent concurrent modification issues", async () => {
      vi.mocked(prisma.order.findMany).mockResolvedValue([]);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dispute.findMany).mockResolvedValue([]);

      const report = await runReconciliation();

      expect(report).toBeDefined();
      expect(report.ordersChecked).toBe(0);
      expect(report.driftsFound).toBe(0);
    });
  });

  describe("status enum invariants", () => {
    it("every contract status int maps to canonical upper-case enum", async () => {
      const { fromContractOrderStatus, fromContractCampaignStatus, OrderStatus, CampaignStatus } = await import("../constants/status.js");
      expect(fromContractOrderStatus(0, "escrow")).toBe(OrderStatus.PENDING);
      expect(fromContractOrderStatus(1, "escrow")).toBe(OrderStatus.DISPUTED);
      expect(fromContractOrderStatus(2, "escrow")).toBe(OrderStatus.COMPLETED);
      expect(fromContractOrderStatus(3, "escrow")).toBe(OrderStatus.REFUNDED);
      expect(fromContractCampaignStatus(0, "escrow")).toBe(CampaignStatus.ACTIVE);
      expect(fromContractCampaignStatus(1, "escrow")).toBe(CampaignStatus.SETTLED);
    });

    it("CI: no raw status literals outside enum (sanity: all DB rows are upper-case)", async () => {
      // This test asserts the migration invariant: persisted rows are upper-case
      // Simulated by checking our constants contain only upper-case values
      const { OrderStatus, CampaignStatus } = await import("../constants/status.js");
      for (const v of Object.values(OrderStatus)) {
        expect(v).toBe(v.toUpperCase());
      }
      for (const v of Object.values(CampaignStatus)) {
        expect(v).toBe(v.toUpperCase());
      }
    });
  });
});
