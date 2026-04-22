import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockchainEventPersistenceService } from "./blockchainEventPersistenceService.js";
import type { IndexedEvent } from "../../types/indexedEvent.js";

const findUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("../../config/database.js", () => ({
  prisma: {
    blockchainTransaction: {
      findUnique: findUniqueMock,
    },
    $transaction: transactionMock,
  },
}));

describe("BlockchainEventPersistenceService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips persistence when event already exists", async () => {
    findUniqueMock.mockResolvedValue({ id: "existing" });

    const event: IndexedEvent = {
      sourceEventId: "12-1",
      eventType: "order.created",
      entity: "order",
      action: "created",
      ledger: 12,
      eventIndex: 1,
      timestamp: new Date(),
      payload: [],
      orderIdOnChain: "order-1",
    };

    await BlockchainEventPersistenceService.persist(event);

    expect(transactionMock).not.toHaveBeenCalled();
  });
});
