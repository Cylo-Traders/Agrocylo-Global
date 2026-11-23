import { describe, it, expect } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { buildFeeForTransaction } from "./contractService";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  describe("escrow ABI conformance", () => {
    it("uses only entry points exported by the Rust escrow contract", () => {
      const repositoryRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../",
      );
      const service = readFileSync(
        path.join(repositoryRoot, "client/src/services/stellar/contractService.ts"),
        "utf8",
      );
      const contract = readFileSync(
        path.join(repositoryRoot, "contracts/escrow/src/lib.rs"),
        "utf8",
      );
      const exportedMethods = new Set(
        [...contract.matchAll(/\bpub\s+fn\s+([a-z_]+)\s*\(/g)].map((match) => match[1]),
      );
      const invokedMethods = new Set([
        ...[...service.matchAll(/contract\.call\(\s*"([a-z_]+)"/g)].map((match) => match[1]),
        ...[...service.matchAll(/buildTransaction\(\s*[^,]+,\s*"([a-z_]+)"/g)].map((match) => match[1]),
      ]);

      expect(invokedMethods.size).toBeGreaterThan(0);
      for (const method of invokedMethods) {
        expect(exportedMethods.has(method), `${method} must be exported by escrow`).toBe(true);
      }
    });
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
