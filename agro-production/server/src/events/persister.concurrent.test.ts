import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventPersister } from "./persister.js";
import type { CampaignCreatedEvent, OrderCreatedEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Mock Prisma, logger, and wsServer for unit-level concurrency tests
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
        totalRaised: "0",
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
      $transaction: vi.fn().mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      ),
    },
  };
});

vi.mock("../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/wsServer.js", () => ({ broadcast: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const baseEvent = {
  ledger: 300,
  eventIndex: 0,
  timestamp: new Date("2024-07-01T00:00:00Z"),
  rawId: "300-0",
};

function makeCampaignCreated(
  overrides?: Partial<CampaignCreatedEvent>,
): CampaignCreatedEvent {
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

function makeOrderCreated(
  overrides?: Partial<OrderCreatedEvent>,
): OrderCreatedEvent {
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

// ---------------------------------------------------------------------------
// Concurrency Tests
// ---------------------------------------------------------------------------
describe("EventPersister — concurrent transaction scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles two concurrent persists of the same event without double write", async () => {
    const { prisma } = await import("../db/client.js");

    // First call sees no duplicate, second call sees the first already committed.
    vi.mocked(prisma.transaction.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "tx-1" } as never);

    const event = makeCampaignCreated();

    await Promise.all([
      EventPersister.persist(event),
      EventPersister.persist(event),
    ]);

    // Only one $transaction should have been called.
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("handles concurrent persists of different events independently", async () => {
    const { prisma } = await import("../db/client.js");

    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null);

    const event1 = makeCampaignCreated({ ledger: 301, eventIndex: 0 });
    const event2 = makeOrderCreated({ ledger: 302, eventIndex: 0 });

    await Promise.all([
      EventPersister.persist(event1),
      EventPersister.persist(event2),
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not lose writes when unique constraint violation is simulated", async () => {
    const { prisma } = await import("../db/client.js");

    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null);

    // Simulate the second concurrent call hitting a unique constraint error.
    vi.mocked(prisma.$transaction)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      );

    const event = makeCampaignCreated();

    const [result1, result2] = await Promise.allSettled([
      EventPersister.persist(event),
      EventPersister.persist(event),
    ]);

    expect(result1.status).toBe("fulfilled");
    expect(result2.status).toBe("rejected");
  });

  it("processes a burst of unique events without race conditions", async () => {
    const { prisma } = await import("../db/client.js");

    vi.mocked(prisma.transaction.findUnique).mockResolvedValue(null);

    const events = Array.from({ length: 10 }, (_, i) =>
      makeCampaignCreated({ ledger: 400 + i, eventIndex: i }),
    );

    await Promise.all(events.map((e) => EventPersister.persist(e)));

    expect(prisma.$transaction).toHaveBeenCalledTimes(10);
  });
});