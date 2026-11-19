import { describe, it, expect } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  estimateInclusionFee,
  buildFeeBumpTransaction,
  readTransactionFee,
  formatFeeXlm,
  MIN_INCLUSION_FEE,
  MAX_INCLUSION_FEE,
} from "../lib/feeStrategy";

const PASSPHRASE = StellarSdk.Networks.TESTNET;

// jsdom's crypto shim breaks Keypair.random(); use fixed valid addresses and
// skip signing (the SDK fee-bump path does not require inner signatures).
const SOURCE = "GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI";
const DEST = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

function feeStatsServer(dist: Record<string, string> | Error) {
  return {
    getFeeStats: async () => {
      if (dist instanceof Error) throw dist;
      return { sorobanInclusionFee: dist, inclusionFee: dist, latestLedger: 1 };
    },
  };
}

function makeInnerTx(fee = "100") {
  const account = new StellarSdk.Account(SOURCE, "0");
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: DEST,
        asset: StellarSdk.Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build();
  return { tx, xdr: tx.toXDR(), feeSource: SOURCE };
}

describe("estimateInclusionFee", () => {
  it("bids above the floor under high congestion", async () => {
    const est = await estimateInclusionFee(
      feeStatsServer({ p70: "5000", max: "20000", mode: "800" }),
      "p70",
    );
    expect(est.fromNetwork).toBe(true);
    // ceil(5000 * 1.15 headroom) = 5750
    expect(Number(est.inclusionFee)).toBe(5750);
  });

  it("stays near the floor under low congestion", async () => {
    const est = await estimateInclusionFee(
      feeStatsServer({ p70: "100", max: "120", mode: "100" }),
      "p70",
    );
    expect(est.fromNetwork).toBe(true);
    expect(Number(est.inclusionFee)).toBeGreaterThanOrEqual(MIN_INCLUSION_FEE);
    expect(Number(est.inclusionFee)).toBeLessThanOrEqual(200);
  });

  it("clamps to the safety ceiling when stats report an extreme surge", async () => {
    const est = await estimateInclusionFee(
      feeStatsServer({ p70: "999999999999" }),
      "p70",
    );
    expect(Number(est.inclusionFee)).toBe(MAX_INCLUSION_FEE);
  });

  it("falls back to the floor when fee stats are unavailable", async () => {
    const est = await estimateInclusionFee(feeStatsServer(new Error("rpc down")));
    expect(est.fromNetwork).toBe(false);
    expect(est.inclusionFee).toBe(String(MIN_INCLUSION_FEE));
  });

  it("falls back to the floor when the percentile is missing", async () => {
    const est = await estimateInclusionFee(feeStatsServer({}), "p70");
    expect(est.fromNetwork).toBe(false);
    expect(est.inclusionFee).toBe(String(MIN_INCLUSION_FEE));
  });
});

describe("buildFeeBumpTransaction", () => {
  it("produces a valid fee-bump wrapping the original inner transaction", () => {
    const { tx: inner, xdr, feeSource } = makeInnerTx("100");

    const bumpedXdr = buildFeeBumpTransaction(xdr, feeSource, PASSPHRASE, "5000");
    const parsed = StellarSdk.TransactionBuilder.fromXDR(bumpedXdr, PASSPHRASE);

    expect(parsed).toBeInstanceOf(StellarSdk.FeeBumpTransaction);
    const feeBump = parsed as StellarSdk.FeeBumpTransaction;
    expect(Buffer.from(feeBump.innerTransaction.hash()).toString("hex")).toBe(
      Buffer.from(inner.hash()).toString("hex"),
    );
    // Fee-bump fee must exceed the inner fee; the SDK charges per operation + 1.
    expect(BigInt(feeBump.fee)).toBeGreaterThan(BigInt(inner.fee));
  });
});

describe("readTransactionFee / formatFeeXlm", () => {
  it("reads the committed fee from built XDR", () => {
    const { xdr } = makeInnerTx("2500");
    expect(readTransactionFee(xdr, PASSPHRASE)).toBe("2500");
  });

  it("returns null for unparseable XDR", () => {
    expect(readTransactionFee("not-xdr", PASSPHRASE)).toBeNull();
  });

  it("formats stroop fees as exact XLM", () => {
    expect(formatFeeXlm("10000000")).toBe("1 XLM");
    expect(formatFeeXlm("1000000")).toBe("0.1 XLM");
    expect(formatFeeXlm("5750")).toBe("0.000575 XLM");
    expect(formatFeeXlm(null)).toBe("—");
  });
});
