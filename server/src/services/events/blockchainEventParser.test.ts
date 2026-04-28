import { describe, expect, it } from "vitest";
import { BlockchainEventParser } from "./blockchainEventParser.js";

describe("BlockchainEventParser", () => {
  it("parses order.created payload", () => {
    const parsed = BlockchainEventParser.parseDecoded(
      ["order", "created"],
      ["ord-1", "buyer-1", "seller-1", "100", "USDC"],
      { id: "120-3", ledger: 120, ledgerCloseAt: "1710000000" },
    );

    expect(parsed).toMatchObject({
      eventType: "order.created",
      orderIdOnChain: "ord-1",
      actorAddress: "buyer-1",
      secondaryAddress: "seller-1",
      amount: "100",
      token: "USDC",
      eventIndex: 3,
    });
  });

  it("returns null for unsupported event types", () => {
    const parsed = BlockchainEventParser.parseDecoded(
      ["order", "refunded"],
      ["ord-1", "buyer-1"],
      { id: "120-4", ledger: 120, ledgerCloseAt: "1710000000" },
    );

    expect(parsed).toBeNull();
  });
});
