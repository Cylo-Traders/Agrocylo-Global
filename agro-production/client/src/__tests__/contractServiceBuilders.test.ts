// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";

const rpcDoubles = vi.hoisted(() => ({
  getFeeStats: vi.fn(async () => ({ sorobanInclusionFee: { p70: "150" } })),
  simulateTransaction: vi.fn(async () => ({
    transactionData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    minResourceFee: "0",
    latestLedger: 100,
    events: [],
  })),
  getAccount: vi.fn(),
}));

vi.mock("../lib/rpcClient", () => ({
  createSorobanRpcServer: () => new (class MockRpcServer {
    getFeeStats = rpcDoubles.getFeeStats;
    simulateTransaction = rpcDoubles.simulateTransaction;
    getAccount = rpcDoubles.getAccount;
  })(),
}));

vi.mock("../lib/transactionAssembler", () => ({
  assembleSorobanTransaction: (transaction: { operations: unknown[] }) => ({
    build: () => transaction,
  }),
}));

// Deterministic valid strkeys (Keypair.random() is broken under jsdom).
const CONTRACT_ID = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1));
const FARMER = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const INVESTOR = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
const ATTESTER = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
const ADMIN = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
const OTHER = StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
process.env.NEXT_PUBLIC_PRODUCTION_CONTRACT_ID = CONTRACT_ID;

import * as builders from "../lib/contractService";

/** Capture the (method, ...args) passed to `Contract.prototype.call`. */
let callSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  rpcDoubles.getAccount.mockImplementation(async () => new StellarSdk.Account(FARMER, "1"));
  // Keep the real SDK operation so XDR serialization exercises the same
  // wallet-adapter boundary the app uses. The spy only records the args.
  callSpy = vi.spyOn(StellarSdk.Contract.prototype, "call");
});

function invocation() {
  expect(callSpy).toHaveBeenCalledTimes(1);
  const [method, ...args] = callSpy.mock.calls[0] as [string, ...StellarSdk.xdr.ScVal[]];
  return { method, args: args.map((a) => StellarSdk.scValToNative(a)) };
}

describe("contractService builders — XDR contents", () => {
  it("buildStartProduction encodes start_production(farmer, campaign_id)", async () => {
    const res = await builders.buildStartProduction(FARMER, "42");
    expect(res.success, res.error).toBe(true);
    expect(typeof res.data).toBe("string");
    const { method, args } = invocation();
    expect(method).toBe("start_production");
    expect(args[0]).toBe(FARMER);
    expect(args[1]).toBe(42n);
  });

  it("buildMarkHarvest encodes the attester co-signer", async () => {
    await builders.buildMarkHarvest(FARMER, ATTESTER, "7");
    const { method, args } = invocation();
    expect(method).toBe("mark_harvest");
    expect(args).toEqual([FARMER, ATTESTER, 7n]);
  });

  it("buildAdvanceMilestone encodes advance_milestone(caller, attester, campaign_id)", async () => {
    await builders.buildAdvanceMilestone(OTHER, ATTESTER, "9");
    const { method, args } = invocation();
    expect(method).toBe("advance_milestone");
    expect(args).toEqual([OTHER, ATTESTER, 9n]);
  });

  it("buildSettle encodes settle(caller, campaign_id)", async () => {
    await builders.buildSettle(FARMER, "3");
    expect(invocation()).toEqual({ method: "settle", args: [FARMER, 3n] });
  });

  it("buildRefund encodes refund(investor, campaign_id)", async () => {
    await builders.buildRefund(INVESTOR, "12");
    expect(invocation()).toEqual({ method: "refund", args: [INVESTOR, 12n] });
  });

  it("buildClaimReturns encodes claim_returns(investor, campaign_id)", async () => {
    await builders.buildClaimReturns(INVESTOR, "12");
    expect(invocation()).toEqual({ method: "claim_returns", args: [INVESTOR, 12n] });
  });

  it("buildMarkCampaignFailed encodes mark_campaign_failed(caller, campaign_id)", async () => {
    await builders.buildMarkCampaignFailed(ADMIN, "5");
    expect(invocation()).toEqual({ method: "mark_campaign_failed", args: [ADMIN, 5n] });
  });

  it("buildBatchRefundInvestors encodes the investor vector", async () => {
    await builders.buildBatchRefundInvestors(ADMIN, "5", [INVESTOR, OTHER]);
    const { method, args } = invocation();
    expect(method).toBe("batch_refund_investors");
    expect(args[0]).toBe(5n);
    expect(args[1]).toEqual([INVESTOR, OTHER]);
  });

  it("buildTransferInvestment encodes transfer_investment(from, to, campaign_id)", async () => {
    await builders.buildTransferInvestment(INVESTOR, OTHER, "8");
    expect(invocation()).toEqual({
      method: "transfer_investment",
      args: [INVESTOR, OTHER, 8n],
    });
  });

  it("buildOpenDispute encodes open_dispute(caller, campaign_id)", async () => {
    await builders.buildOpenDispute(INVESTOR, "8");
    expect(invocation()).toEqual({ method: "open_dispute", args: [INVESTOR, 8n] });
  });

  it("buildResolveDispute encodes the RefundInvestors resolution variant", async () => {
    await builders.buildResolveDispute(ADMIN, "8", { tag: "RefundInvestors" });
    const { method, args } = invocation();
    expect(method).toBe("resolve_dispute");
    expect(args[0]).toBe(ADMIN);
    expect(args[1]).toBe(8n);
    // enum unit variant → symbol / tagged form
    expect(JSON.stringify(args[2])).toMatch(/RefundInvestors/);
  });

  it("buildResolveDispute encodes the Partial(bps) resolution variant", async () => {
    await builders.buildResolveDispute(ADMIN, "8", { tag: "Partial", farmerBps: 4000 });
    const { args } = invocation();
    expect(JSON.stringify(args[2])).toMatch(/Partial/);
    expect(JSON.stringify(args[2])).toMatch(/4000/);
  });

  it("buildConfirmOrder / buildCancelOrder target orders by id", async () => {
    await builders.buildConfirmOrder(OTHER, "99");
    expect(invocation()).toEqual({ method: "confirm_order", args: [OTHER, 99n] });
  });

  it("produces XDR that parses back to an invoke-host-function operation", async () => {
    const res = await builders.buildRefund(INVESTOR, "12");
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      res.data as string,
      process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
        "Test SDF Network ; September 2015",
    ) as StellarSdk.Transaction;
    expect(tx.operations[0].type).toBe("invokeHostFunction");
  });

  it("integration: the full farmer lifecycle builds in sequence", async () => {
    const steps = [
      () => builders.buildStartProduction(FARMER, "1"),
      () => builders.buildMarkHarvest(FARMER, ATTESTER, "1"),
      () => builders.buildSettle(FARMER, "1"),
    ];
    for (const step of steps) {
      const res = await step();
      expect(res.success, res.error).toBe(true);
      expect(typeof res.data).toBe("string");
    }
  });

  it("returns a graceful error (never throws) for an invalid address", async () => {
    // A malformed strkey must not throw synchronously out of the builder —
    // ScVal construction happens inside buildContractTx's try/catch.
    const bad = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    let res: Awaited<ReturnType<typeof builders.buildInvest>> | undefined;
    await expect(
      (async () => {
        res = await builders.buildInvest(bad, "1", 100_000n);
      })(),
    ).resolves.not.toThrow();
    expect(res?.success).toBe(false);
    expect(typeof res?.error).toBe("string");
    expect(callSpy).not.toHaveBeenCalled();
  });
});
