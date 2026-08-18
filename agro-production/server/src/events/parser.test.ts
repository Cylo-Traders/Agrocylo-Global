import { describe, expect, it } from "vitest";
import { ProductionEventParser } from "./parser.js";
import type { RawSorobanEvent } from "./types.js";

// Helpers — build minimal fake raw events with pre-encoded topics/values.
// Rather than calling the real stellar-sdk encoder, we test the parser against
// the actual SDK encoding to verify round-trip correctness.
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";

function encodeVal(native: unknown): string {
  return nativeToScVal(native).toXDR("base64");
}

function encodeSymbol(s: string): string {
  return xdr.ScVal.scvSymbol(s).toXDR("base64");
}

function makeRaw(
  namespace: string,
  verb: string,
  dataTuple: unknown[],
  id = "100-0",
  ledger = 100,
): RawSorobanEvent {
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
    contractId: "CTEST",
    txHash: "a".repeat(64),
    topic: [encodeSymbol(namespace), encodeSymbol(verb)],
    value: encodeVal(dataTuple),
  };
}

describe("ProductionEventParser", () => {
  describe("campaign.created", () => {
    it("parses correctly", () => {
      const raw = makeRaw("campaign", "created", [1n, "GFARMER", "GTOKEN", 10000n, 9999n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("campaign.created");
      if (event.action === "campaign.created") {
        expect(event.campaignId).toBe("1");
        expect(event.farmer).toBe("GFARMER");
        expect(event.token).toBe("GTOKEN");
        expect(event.targetAmount).toBe("10000");
        expect(event.deadline).toBe("9999");
      }
    });
  });

  describe("campaign.invested", () => {
    it("parses correctly", () => {
      const raw = makeRaw("campaign", "invested", [2n, "GINVESTOR", 5000n, 5000n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("campaign.invested");
      if (event.action === "campaign.invested") {
        expect(event.campaignId).toBe("2");
        expect(event.investor).toBe("GINVESTOR");
        expect(event.amount).toBe("5000");
        expect(event.totalRaised).toBe("5000");
        expect(event.txHash).toBe("a".repeat(64));
      }
    });
  });

  describe("campaign.settled", () => {
    it("parses correctly", () => {
      const raw = makeRaw("campaign", "settled", [3n, 2000n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("campaign.settled");
      if (event.action === "campaign.settled") {
        expect(event.campaignId).toBe("3");
        expect(event.totalRevenue).toBe("2000");
      }
    });
  });

  describe("order.created", () => {
    it("parses correctly", () => {
      const raw = makeRaw("order", "created", [10n, "GBUYER", 3n, 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("order.created");
      if (event.action === "order.created") {
        expect(event.orderId).toBe("10");
        expect(event.buyer).toBe("GBUYER");
        expect(event.campaignId).toBe("3");
        expect(event.amount).toBe("500");
      }
    });
  });

  describe("order.confirmed", () => {
    it("parses correctly", () => {
      const raw = makeRaw("order", "confirmed", [10n, "GBUYER", 3n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("order.confirmed");
      if (event.action === "order.confirmed") {
        expect(event.orderId).toBe("10");
        expect(event.buyer).toBe("GBUYER");
        expect(event.campaignId).toBe("3");
      }
    });
  });

  describe("basket.created", () => {
    it("parses correctly", () => {
      const raw = makeRaw("basket", "created", [1n, 3]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("basket.created");
      if (event.action === "basket.created") {
        expect(event.basketId).toBe("1");
        expect(event.constituentsCount).toBe(3);
      }
    });
  });

  describe("basket.deposit", () => {
    it("parses correctly", () => {
      const raw = makeRaw("basket", "deposit", [1n, "GDEPOSITOR", 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("basket.deposit");
      if (event.action === "basket.deposit") {
        expect(event.basketId).toBe("1");
        expect(event.depositor).toBe("GDEPOSITOR");
        expect(event.amount).toBe("500");
      }
    });
  });

  describe("basket.funded", () => {
    it("parses correctly", () => {
      const raw = makeRaw("basket", "funded", [1n, 1500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("basket.funded");
      if (event.action === "basket.funded") {
        expect(event.basketId).toBe("1");
        expect(event.totalDeposit).toBe("1500");
      }
    });
  });

  describe("basket.withdrawn", () => {
    it("parses correctly", () => {
      const raw = makeRaw("basket", "withdrawn", [1n, "GDEPOSITOR", 500n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("basket.withdrawn");
      if (event.action === "basket.withdrawn") {
        expect(event.basketId).toBe("1");
        expect(event.depositor).toBe("GDEPOSITOR");
        expect(event.depositAmount).toBe("500");
      }
    });
  });

  describe("basket.claimed", () => {
    it("parses correctly", () => {
      const raw = makeRaw("basket", "claimed", [1n, "GDEPOSITOR", 620n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.action).toBe("basket.claimed");
      if (event.action === "basket.claimed") {
        expect(event.basketId).toBe("1");
        expect(event.depositor).toBe("GDEPOSITOR");
        expect(event.payout).toBe("620");
      }
    });
  });

  describe("generic campaign events", () => {
    it.each(["produce", "harvest", "failed", "disputed", "claimed", "refunded", "tranche"])(
      "parses campaign.%s",
      (verb) => {
        const raw = makeRaw("campaign", verb, [5n]);
        const event = ProductionEventParser.parse(raw);
        expect(event.action).toBe(`campaign.${verb}`);
        if (
          event.action !== "campaign.created" &&
          event.action !== "campaign.invested" &&
          event.action !== "campaign.settled" &&
          event.action !== "order.created" &&
          event.action !== "order.confirmed"
        ) {
          expect(event.campaignId).toBe("5");
        }
      },
    );
  });

  describe("error handling", () => {
    it("throws on unknown namespace+verb", () => {
      const raw = makeRaw("unknown", "action", []);
      expect(() => ProductionEventParser.parse(raw)).toThrow();
    });

    it("tryParse returns null instead of throwing", () => {
      const raw = makeRaw("unknown", "action", []);
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it("throws on too few topics", () => {
      const raw: RawSorobanEvent = {
        id: "1-0",
        type: "contract",
        ledger: 1,
        ledgerClosedAt: new Date().toISOString(),
        contractId: "C",
        topic: [encodeSymbol("campaign")],
        value: encodeVal([]),
      };
      expect(() => ProductionEventParser.parse(raw)).toThrow();
    });
  });

  describe("metadata", () => {
    it("captures ledger and eventIndex", () => {
      const raw = makeRaw("campaign", "settled", [1n, 0n], "500-3", 500);
      const event = ProductionEventParser.parse(raw);
      expect(event.ledger).toBe(500);
      expect(event.eventIndex).toBe(3);
    });

    it("parses timestamp from ledgerClosedAt", () => {
      const raw = makeRaw("campaign", "settled", [1n, 0n]);
      const event = ProductionEventParser.parse(raw);
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it("stores rawId from the event id field", () => {
      const raw = makeRaw("campaign", "settled", [1n, 0n], "777-2", 777);
      const event = ProductionEventParser.parse(raw);
      expect(event.rawId).toBe("777-2");
    });

    it("defaults eventIndex to 0 when id has no hyphen", () => {
      const raw = makeRaw("campaign", "settled", [1n, 0n], "noindex", 100);
      const event = ProductionEventParser.parse(raw);
      expect(event.eventIndex).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("coerces numeric ScVal data to string", () => {
      const raw = makeRaw("campaign", "created", [999n, "GFARMER", "GTOKEN", 5000n, 8888n]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === "campaign.created") {
        expect(typeof event.campaignId).toBe("string");
        expect(event.campaignId).toBe("999");
        expect(event.targetAmount).toBe("5000");
      }
    });

    it("handles empty data array for generic events without throwing", () => {
      const raw = makeRaw("campaign", "produce", [5n]);
      expect(() => ProductionEventParser.parse(raw)).not.toThrow();
    });

    it("tryParse returns null for events with malformed value XDR", () => {
      const raw: RawSorobanEvent = {
        id: "1-0",
        type: "contract",
        ledger: 1,
        ledgerClosedAt: new Date().toISOString(),
        contractId: "C",
        topic: [encodeSymbol("campaign"), encodeSymbol("created")],
        value: "not-valid-base64-xdr!!!",
      };
      // parse throws, tryParse should swallow and return null
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it("throws for order namespace with unknown verb", () => {
      const raw = makeRaw("order", "cancelled", []);
      expect(() => ProductionEventParser.parse(raw)).toThrow(/unknown action/);
    });

    it("tryParse returns null instead of throwing for order unknown verb", () => {
      const raw = makeRaw("order", "cancelled", []);
      expect(ProductionEventParser.tryParse(raw)).toBeNull();
    });

    it("parses order.created with zero-amount correctly", () => {
      const raw = makeRaw("order", "created", [1n, "GBUYER", 2n, 0n]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === "order.created") {
        expect(event.amount).toBe("0");
      }
    });

    it("parses campaign.invested with large i128 values without precision loss", () => {
      const large = BigInt("170141183460469231731687303715884105727"); // i128 max
      const raw = makeRaw("campaign", "invested", [1n, "GINVESTOR", large, large]);
      const event = ProductionEventParser.parse(raw);
      if (event.action === "campaign.invested") {
        expect(event.amount).toBe(large.toString());
        expect(event.totalRaised).toBe(large.toString());
      }
    });
  });
});
