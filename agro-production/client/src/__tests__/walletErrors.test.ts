import { describe, expect, it } from "vitest";
import { classifyError } from "@/lib/errorHandling";
import { isWalletError, WalletRejectionError } from "@/lib/wallets/errors";

describe("wallet error classification is provider-agnostic", () => {
  it("classifies a kit rejection as a wallet problem", () => {
    expect(
      classifyError(new WalletRejectionError("xbull", "Transaction rejected by xBull Wallet"), "submitOrderTransaction")
        .category,
    ).toBe("wallet");
  });

  it("classifies provider rejection text without naming any provider", () => {
    for (const message of [
      "The user declined the access request.",
      "Request rejected by the connected wallet",
      "User cancelled the signature request",
      "No wallet extension detected",
    ]) {
      expect(classifyError(new Error(message)).category).toBe("wallet");
    }
  });

  it("no longer special-cases a single provider name", () => {
    // A message that only names a wallet product, with none of the generic
    // wallet vocabulary, is no longer forced into the wallet bucket.
    expect(classifyError(new Error("freighter-api exploded")).category).not.toBe("wallet");
  });

  it("keeps network, validation, and contract classification intact", () => {
    expect(classifyError(new Error("Network request failed")).category).toBe("network");
    expect(classifyError(new Error("amount is invalid")).category).toBe("validation");
    expect(classifyError(new Error("soroban simulation failed")).category).toBe("contract");
  });

  it("isWalletError accepts strings, errors, and the typed rejection", () => {
    expect(isWalletError("user declined the request")).toBe(true);
    expect(isWalletError(new Error("permission denied by wallet"))).toBe(true);
    expect(isWalletError(new WalletRejectionError("albedo", "rejected"))).toBe(true);
    expect(isWalletError(new Error("database connection pool exhausted"))).toBe(false);
  });
});
