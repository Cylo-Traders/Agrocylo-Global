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
  });
});
