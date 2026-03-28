import { describe, it, expect, vi } from "vitest";
import { EscrowEventIngestionService } from "./escrowEventIngestionService.js";
import { EscrowEventParser } from "./escrowEventParser.js";
import { EscrowEventRepository } from "./escrowEventRepository.js";
import { EscrowEventProjectionService } from "./escrowEventProjectionService.js";

vi.mock("../../config/database.js", () => ({
    prisma: {
        escrowEvent: { upsert: vi.fn(), create: vi.fn() },
        transaction: { create: vi.fn() },
        user: { upsert: vi.fn() },
        order: { upsert: vi.fn(), update: vi.fn() },
        product: { findFirst: vi.fn() },
        priceHistory: { create: vi.fn() }
    },
    default: { query: vi.fn() }
}));

vi.mock("./escrowEventProjectionService.js", () => ({
    EscrowEventProjectionService: {
        projectEvent: vi.fn()
    }
}));

describe("EscrowEventIngestionService", () => {
  it("should orchestrate ingestion flow", async () => {
    // Mock dependency calls to avoid real DB and SDK interaction in this context
    const mockRecord = { id: "test-id" };
    
    vi.spyOn(EscrowEventParser, "parse").mockReturnValue({
        action: "created",
        orderId: "1",
        buyer: "B",
        seller: "S",
        amount: "100",
        token: "T",
        ledger: 100,
        eventIndex: 1,
        timestamp: 1711234567
    });

    vi.spyOn(EscrowEventRepository, "createEscrowEvent").mockResolvedValue(mockRecord as any);

    const result = await EscrowEventIngestionService.ingestEvent({ value: "mock-value", id: "0-0", topic: [] });
    
    expect(result).toEqual(mockRecord);
    expect(EscrowEventRepository.createEscrowEvent).toHaveBeenCalled();
  });
});
