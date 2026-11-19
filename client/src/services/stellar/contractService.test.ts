import { describe, it, expect } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { buildFeeForTransaction } from "./contractService";

// Minimal mock of SimulateTransactionSuccessResponse
function makeSim(minResourceFee: string | number) {
  return {
    minResourceFee: String(minResourceFee),
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

describe("buildFeeForTransaction", () => {
  it("returns simulated resource fee when higher than BASE_FEE", () => {
    // BASE_FEE is 100 stroops; a simulated 500 should be returned as-is
    const fee = buildFeeForTransaction(makeSim(500));
    expect(fee).toBe("500");
  });

  it("returns BASE_FEE when simulated resource fee is lower", () => {
    // Simulated 50 stroops — should floor at BASE_FEE (100)
    const fee = buildFeeForTransaction(makeSim(50));
    expect(Number(fee)).toBeGreaterThanOrEqual(100);
  });

  it("caps fee at NEXT_PUBLIC_MAX_FEE_STROOPS when set", () => {
    const original = process.env.NEXT_PUBLIC_MAX_FEE_STROOPS;
    try {
      process.env.NEXT_PUBLIC_MAX_FEE_STROOPS = "300";
      const fee = buildFeeForTransaction(makeSim(5000));
      expect(Number(fee)).toBeLessThanOrEqual(300);
    } finally {
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_MAX_FEE_STROOPS;
      } else {
        process.env.NEXT_PUBLIC_MAX_FEE_STROOPS = original;
      }
    }
  });

  it("returns BASE_FEE when resourceFee is zero or missing", () => {
    const fee = buildFeeForTransaction(makeSim(0));
    expect(Number(fee)).toBeGreaterThanOrEqual(100);
  });
});
