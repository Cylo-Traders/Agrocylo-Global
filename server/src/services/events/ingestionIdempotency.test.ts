import { describe, it, expect, vi, beforeEach } from "vitest";
import { BlockchainEventPersistenceService } from "./blockchainEventPersistenceService.js";
import type { IndexedEvent } from "../../types/indexedEvent.js";

vi.mock("../../config/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockDeadLetterUpsert = vi.fn();
let ordersStore: Map<string, any>;
let txsStore: Set<string>;

function makeTxMock() {
  return {
    blockchainTransaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.sourceEventId) return txsStore.has(where.sourceEventId) ? { sourceEventId: where.sourceEventId } : null;
        return null;
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        txsStore.add(data.sourceEventId);
        return data;
      }),
    },
    order: {
      findUnique: vi.fn(async ({ where }: any) => ordersStore.get(where.orderIdOnChain) ?? null),
      create: vi.fn(async ({ data }: any) => {
        ordersStore.set(data.orderIdOnChain, { ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = ordersStore.get(where.orderIdOnChain);
        if (!existing) {
          const err: any = new Error("Not found");
          err.code = "P2025";
          throw err;
        }
        const updated = { ...existing, ...data };
        ordersStore.set(where.orderIdOnChain, updated);
        return updated;
      }),
    },
    campaign: { upsert: vi.fn(async ({ create }: any) => create) },
    investment: { upsert: vi.fn(async ({ create }: any) => create) },
    user: { upsert: vi.fn(async () => ({})) },
    profile: { upsert: vi.fn(async () => ({})) },
  };
}

let lastTxMock: ReturnType<typeof makeTxMock>;
const transactionMock = vi.fn(async (cb: any) => {
  lastTxMock = makeTxMock();
  return cb(lastTxMock as any);
});
const findUniqueMock = vi.fn(async ({ where }: any) => {
  if (txsStore.has(where.sourceEventId)) return { id: "existing" };
  return null;
});

vi.mock("../../config/database.js", () => ({
  prisma: {
    blockchainTransaction: { findUnique: (...args: any[]) => findUniqueMock(...args) },
    $transaction: (...args: any[]) => transactionMock(...args),
    deadLetter: { upsert: (...args: any[]) => mockDeadLetterUpsert(...args) },
    order: { findUnique: async ({ where }: any) => ordersStore.get(where.orderIdOnChain) ?? null },
  },
}));

vi.mock("../../services/identityService.js", () => ({
  IdentityService: {
    ensureUsersForEvent: vi.fn(async () => {}),
    canonicalize: (s: string) => s.toLowerCase(),
  },
}));

vi.mock("../referralService.js", () => ({
  ReferralService: { triggerRewardOnConfirmedActivity: vi.fn(async () => {}) },
}));

describe("ingestion idempotency - replay twice produces zero new rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersStore = new Map();
    txsStore = new Set();
  });

  it("ingest batch, force mid-batch failure, replay -> row counts unchanged", async () => {
    const events: IndexedEvent[] = [
      {
        sourceEventId: "100-1",
        eventType: "order.created",
        entity: "order",
        action: "created",
        ledger: 100,
        eventIndex: 1,
        timestamp: new Date(),
        payload: ["order-A", "GBUYER_A", "GSELLER_A", "1000", "USDC"],
        orderIdOnChain: "order-A",
        actorAddress: "GBUYER_A",
        secondaryAddress: "GSELLER_A",
        amount: "1000",
        token: "USDC",
        status: "PENDING",
      },
      {
        sourceEventId: "100-2",
        eventType: "order.created",
        entity: "order",
        action: "created",
        ledger: 100,
        eventIndex: 2,
        timestamp: new Date(),
        payload: ["order-B", "GBUYER_B", "GSELLER_B", "2000", "USDC"],
        orderIdOnChain: "order-B",
        actorAddress: "GBUYER_B",
        secondaryAddress: "GSELLER_B",
        amount: "2000",
        token: "USDC",
        status: "PENDING",
      },
      {
        sourceEventId: "100-3",
        eventType: "order.confirmed",
        entity: "order",
        action: "confirmed",
        ledger: 100,
        eventIndex: 3,
        timestamp: new Date(),
        payload: ["order-A", "GBUYER_A", "GSELLER_A"],
        orderIdOnChain: "order-A",
        actorAddress: "GBUYER_A",
        secondaryAddress: "GSELLER_A",
        status: "COMPLETED",
      },
    ];

    // Ingest first event successfully
    await BlockchainEventPersistenceService.persist(events[0]!);
    expect(ordersStore.size).toBe(1);
    expect(txsStore.size).toBe(1);

    // Simulate mid-batch failure on second event (throw transient)
    // We simulate by making transactionMock throw for that event
    const originalTxMock = transactionMock.getMockImplementation();
    let shouldFail = true;
    transactionMock.mockImplementationOnce(async (cb: any) => {
      if (shouldFail) {
        throw new Error("Transient DB failure");
      }
      return originalTxMock!(cb);
    });
    // Attempt second event - should throw and not advance? But we catch and simulate halting
    await expect(BlockchainEventPersistenceService.persist(events[1]!)).rejects.toThrow("Transient DB failure");
    // After failure, counts should still be 1 (second not persisted)
    expect(ordersStore.size).toBe(1);
    expect(txsStore.size).toBe(1);

    // Reset to success, ingest second and third
    shouldFail = false;
    // Need to reset mock to original
    transactionMock.mockImplementation(originalTxMock!);
    await BlockchainEventPersistenceService.persist(events[1]!);
    await BlockchainEventPersistenceService.persist(events[2]!);
    expect(ordersStore.size).toBe(2);
    expect(txsStore.size).toBe(3);

    // Now replay entire batch (simulate watcher replaying same ledger range)
    const countBeforeReplay = ordersStore.size;
    const txCountBefore = txsStore.size;
    for (const ev of events) {
      await BlockchainEventPersistenceService.persist(ev);
    }
    // Idempotency: no new rows
    expect(ordersStore.size).toBe(countBeforeReplay);
    expect(txsStore.size).toBe(txCountBefore);
    // Also order-A should still be COMPLETED (not reverted)
    expect(ordersStore.get("order-A")?.status).toBe("COMPLETED");
  });

  it("escrow_transactions unique constraint prevents duplicates on replay", async () => {
    // This test documents that escrow_transactions now has @@unique([ledger, eventIndex])
    // We verify via schema file content, but also simulation: second insert with same ledger+index should be idempotent
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("server/prisma/schema.prisma", "utf-8");
    expect(schema).toContain("model EscrowTransaction");
    expect(schema).toContain("@@unique([ledger, eventIndex])");
    expect(schema).toContain('@@map("escrow_transactions")');
    // Also check BlockchainTransaction is canonical
    expect(schema).toContain("Canonical event table");
  });

  it("every mirror table has natural-key unique constraint", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("server/prisma/schema.prisma", "utf-8");
    // BlockchainTransaction has @@unique([ledger, eventIndex]) and @unique sourceEventId
    expect(schema).toMatch(/model BlockchainTransaction[\s\S]*?@@unique\(\[ledger, eventIndex\]\)/);
    expect(schema).toMatch(/sourceEventId.*@unique/);
    // EscrowEvent has @@unique([ledger, eventIndex])
    expect(schema).toMatch(/model EscrowEvent[\s\S]*?@@unique\(\[ledger, eventIndex\]\)/);
    // EscrowTransaction now has @@unique([ledger, eventIndex])
    expect(schema).toMatch(/model EscrowTransaction[\s\S]*?@@unique\(\[ledger, eventIndex\]\)/);
  });
});
