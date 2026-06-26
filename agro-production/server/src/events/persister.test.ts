import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventPersister } from "./persister.js";
import type {
  CampaignCreatedEvent,
  CampaignInvestedEvent,
  CampaignSettledEvent,
  GenericCampaignEvent,
  OrderConfirmedEvent,
  OrderCreatedEvent,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mock Prisma and logger so tests stay unit-level and don't need a real DB.
// ---------------------------------------------------------------------------
vi.mock("../db/client.js", () => {
  const tx = {
    user: { upsert: vi.fn().mockResolvedValue({}) },
    campaign: {
      upsert: vi.fn().mockResolvedValue({ id: "camp-uuid" }),
      findUnique: vi.fn().mockResolvedValue({
        id: "camp-uuid",
        onChainId: "1",
        targetAmount: "10000",
        totalRaised: "5000",
        totalRevenue: "0",
        status: "FUNDING",
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    investment: { upsert: vi.fn().mockResolvedValue({}) },
    order: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: "order-uuid",
        onChainId: "10",
        campaignId: "camp-uuid",
        amount: "500",
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
  };

  return {
    prisma: {
      transaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      campaign: {
        findUnique: vi.fn().mockResolvedValue({ id: "camp-uuid" }),
        update: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn().mockImplementation((fn: (tx: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    },
  };
});

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/wsServer.js", () => ({ broadcast: vi.fn() }));

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------
const baseEvent = {
  ledger: 200,
  eventIndex: 0,
  timestamp: new Date("2024-06-01T00:00:00Z"),
  rawId: "200-0",
};

function makeCampaignCreated(overrides?: Partial<CampaignCreatedEvent>): CampaignCreatedEvent {
  return {
    ...baseEvent,
    action: "campaign.created",
    campaignId: "1",
    farmer: "GFARMER000000000000000000000000000000000000000000000000",
    token: "GTOKEN000000000000000000000000000000000000000000000000AA",
    targetAmount: "10000",
    deadline: String(Math.floor(Date.now() / 1000) + 86400),
    ...overrides,
  };
}

function makeCampaignInvested(overrides?: Partial<CampaignInvestedEvent>): CampaignInvestedEvent {
  return {
    ...baseEvent,
    action: "campaign.invested",
    campaignId: "1",
    investor: "GINVESTOR0000000000000000000000000000000000000000000000",
    amount: "5000",
    totalRaised: "5000",
    ...overrides,
  };
}

function makeCampaignSettled(overrides?: Partial<CampaignSettledEvent>): CampaignSettledEvent {
  return {
    ...baseEvent,
    action: "campaign.settled",
    campaignId: "1",
    totalRevenue: "2000",
    ...overrides,
  };
}

function makeOrderCreated(overrides?: Partial<OrderCreatedEvent>): OrderCreatedEvent {
  return {
    ...baseEvent,
    action: "order.created",
    orderId: "10",
    buyer: "GBUYER000000000000000000000000000000000000000000000000AA",
    campaignId: "1",
    amount: "500",
    ...overrides,
  };
}

function makeOrderConfirmed(overrides?: Partial<OrderConfirmedEvent>): OrderConfirmedEvent {
  return {
    ...baseEvent,
    action: "order.confirmed",
    orderId: "10",
    buyer: "GBUYER000000000000000000000000000000000000000000000000AA",
    campaignId: "1",
    ...overrides,
  };
}

function makeGenericCampaign(
  action: GenericCampaignEvent["action"],
  overrides?: Partial<GenericCampaignEvent>,
): GenericCampaignEvent {
  return {
    ...baseEvent,
    action,
    campaignId: "1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EventPersister", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("idempotency / deduplication", () => {
    it("skips an event that already has a transaction record", async () => {
      const { prisma } = await import("../db/client.js");
      const logger = (await import("../config/logger.js")).default;
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce({
        id: "tx-1",
      } as never);

      await EventPersister.persist(makeCampaignCreated());

      // $transaction should never be called when the event is a duplicate.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
        "EventPersister: skipping duplicate",
        expect.objectContaining({ stage: "persist.preflight" }),
      );
    });

    it("processes an event that has not been seen before", async () => {
      const { prisma } = await import("../db/client.js");
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce(null);

      await EventPersister.persist(makeCampaignCreated());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("is safe to call persist twice for the same ledger+eventIndex", async () => {
      const { prisma } = await import("../db/client.js");
      // First call: not seen.
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce(null);
      // Second call: already persisted.
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce({
        id: "tx-1",
      } as never);

      const event = makeCampaignCreated();
      await EventPersister.persist(event);
      await EventPersister.persist(event);

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("skips writes when duplicate is discovered inside transaction scope", async () => {
      const { prisma } = await import("../db/client.js");
      const logger = (await import("../config/logger.js")).default;
      // Preflight sees no duplicate.
      vi.mocked(prisma.transaction.findUnique).mockResolvedValueOnce(null);
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          await fn({
            user: { upsert: vi.fn().mockResolvedValue({}) },
            campaign: { findUnique: vi.fn().mockResolvedValue({ id: "camp-uuid" }) },
            order: { upsert: vi.fn().mockResolvedValue({}) },
            transaction: {
              findUnique: vi.fn().mockResolvedValue({ id: "tx-inside" }),
              create: vi.fn().mockResolvedValue({}),
            },
          });
        },
      );

      await EventPersister.persist(makeOrderCreated());

      expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
        "EventPersister: skipping duplicate",
        expect.objectContaining({ stage: "persist.tx" }),
      );
      expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
  });

  describe("campaign.created", () => {
    it("persists a campaign.created event", async () => {
      const { prisma } = await import("../db/client.js");

      await EventPersister.persist(makeCampaignCreated());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("handles unix-timestamp deadline", async () => {
      await expect(
        EventPersister.persist(
          makeCampaignCreated({ deadline: "1700000000" }),
        ),
      ).resolves.not.toThrow();
    });

    it("handles ISO string deadline", async () => {
      await expect(
        EventPersister.persist(
          makeCampaignCreated({ deadline: "2030-01-01T00:00:00.000Z" }),
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("campaign.invested", () => {
    it("persists a campaign.invested event", async () => {
      const { prisma } = await import("../db/client.js");

      await EventPersister.persist(makeCampaignInvested());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it("warns and skips when campaign is unknown", async () => {
      const logger = (await import("../config/logger.js")).default;
      const { prisma } = await import("../db/client.js");

      // Simulate the inner tx.campaign.findUnique returning null.
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        async (fn: (tx: unknown) => Promise<unknown>) => {
          await fn({
            user: { upsert: vi.fn().mockResolvedValue({}) },
            campaign: { findUnique: vi.fn().mockResolvedValue(null) },
            transaction: {
              findUnique: vi.fn().mockResolvedValue(null),
              create: vi.fn().mockResolvedValue({}),
            },
          });
        },
      );

      await EventPersister.persist(makeCampaignInvested({ campaignId: "unknown" }));

      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        "EventPersister: investment for unknown campaign",
        expect.objectContaining({ campaignId: "unknown" }),
      );
    });
  });

  describe("campaign.settled", () => {
    it("persists a campaign.settled event", async () => {
      const { prisma } = await import("../db/client.js");

      await EventPersister.persist(makeCampaignSettled());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe("order.created", () => {
    it("persists an order.created event", async () => {
      const { prisma } = await import("../db/client.js");

      await EventPersister.persist(makeOrderCreated());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe("order.confirmed", () => {
    it("persists an order.confirmed event", async () => {
      const { prisma } = await import("../db/client.js");

      await EventPersister.persist(makeOrderConfirmed());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe("generic campaign lifecycle events", () => {
    const statusActions: GenericCampaignEvent["action"][] = [
      "campaign.produce",
      "campaign.harvest",
      "campaign.failed",
      "campaign.disputed",
    ];

    for (const action of statusActions) {
      it(`persists ${action} via $transaction`, async () => {
        const { prisma } = await import("../db/client.js");

        await EventPersister.persist(makeGenericCampaign(action));

        expect(prisma.$transaction).toHaveBeenCalledOnce();
      });
    }

    const rawActions: GenericCampaignEvent["action"][] = [
      "campaign.claimed",
      "campaign.refunded",
      "campaign.tranche",
    ];

    for (const action of rawActions) {
      it(`persists ${action} via recordTransaction`, async () => {
        const { prisma } = await import("../db/client.js");

        await EventPersister.persist(makeGenericCampaign(action));

        expect(prisma.transaction.create).toHaveBeenCalledOnce();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    }
  });

  describe("unknown action (fallback)", () => {
    it("records the raw transaction without touching domain models", async () => {
      const { prisma } = await import("../db/client.js");

      // Use an action that falls through to the default branch.
      const event = {
        ...baseEvent,
        action: "campaign.unknown" as never,
        campaignId: "1",
      };

      await EventPersister.persist(event);

      // Falls through to recordTransaction — uses prisma.transaction.create directly.
      expect(prisma.transaction.create).toHaveBeenCalledOnce();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("error resilience", () => {
    it("propagates DB errors so the caller can handle them", async () => {
      const { prisma } = await import("../db/client.js");
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("DB connection lost"));

      await expect(EventPersister.persist(makeCampaignCreated())).rejects.toThrow(
        "DB connection lost",
      );
    });
  });
});
