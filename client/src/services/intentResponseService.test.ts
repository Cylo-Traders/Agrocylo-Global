import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getResponsesForIntent,
  saveProposal,
  updateProposal,
  cancelProposal,
  acceptProposal,
} from "./intentResponseService";

// Mock contract service
vi.mock("@/services/stellar/contractService", () => ({
  createOrder: vi.fn(() => Promise.resolve({ success: true })),
}));

describe("intentResponseService", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      localStorage.clear();
    }
    vi.clearAllMocks();
  });

  it("should create and persist a new draft or proposal", async () => {
    const resp = await saveProposal(
      "intent_1",
      "GD_SELLER_ADDR",
      15.0,
      100,
      new Date(Date.now() + 86400000).toISOString(),
      "High quality seeds",
      true // isDraft
    );

    expect(resp.status).toBe("draft");
    expect(resp.pricePerUnit).toBe(15.0);
    expect(resp.quantityAvailable).toBe(100);

    const list = await getResponsesForIntent("intent_1");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(resp.id);
  });

  it("should update existing draft to pending when broadcasted", async () => {
    const resp = await saveProposal(
      "intent_2",
      "GD_SELLER_ADDR",
      20.0,
      50,
      new Date(Date.now() + 86400000).toISOString(),
      "Initial bid",
      true // isDraft
    );

    const updated = await updateProposal(
      resp.id,
      25.0,
      60,
      new Date(Date.now() + 172800000).toISOString(),
      "Updated bid",
      false // isDraft=false (broadcast!)
    );

    expect(updated.status).toBe("pending");
    expect(updated.pricePerUnit).toBe(25.0);
    expect(updated.quantityAvailable).toBe(60);
  });

  it("should cancel active proposals", async () => {
    const resp = await saveProposal(
      "intent_3",
      "GD_SELLER_ADDR",
      10.0,
      20,
      new Date(Date.now() + 86400000).toISOString(),
      "Cancel me",
      false
    );

    const cancelled = await cancelProposal(resp.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("should accept active proposals and trigger order pipeline", async () => {
    const resp = await saveProposal(
      "intent_4",
      "GD_SELLER_ADDR",
      5.0,
      200,
      new Date(Date.now() + 86400000).toISOString(),
      "Accept me",
      false
    );

    const accepted = await acceptProposal(resp.id, "GD_BUYER_ADDR");
    expect(accepted.status).toBe("accepted");
  });
});
