import { describe, it, expect } from "vitest";
import { EscrowEventMapper } from "./escrowEventMapper.js";
import type { ParsedEscrowEvent } from "../../types/escrowEvent.js";

describe("EscrowEventMapper", () => {
  it("should map a parsed event to the mapped model shape", () => {
    const parsed: ParsedEscrowEvent = {
        action: "created",
        orderId: "1",
        buyer: "G...",
        seller: "F...",
        amount: "100",
        token: "T...",
        ledger: 100,
        eventIndex: 1,
        timestamp: 1711364400 // March 25, 2024
    };

    const mapped = EscrowEventMapper.mapToModel(parsed);

    expect(mapped.orderId).toBe("1");
    expect(mapped.action).toBe("created");
    expect(mapped.seller).toBe("F...");
    expect(mapped.timestamp).toBeInstanceOf(Date);
    expect(mapped.ledger).toBe(100);
  });
});
