/**
 * Utilities for building base64-encoded XDR ScVals that the parser and watcher
 * expect from the Soroban JSON-RPC event feed.
 */
import * as StellarSdk from "@stellar/stellar-sdk";

const { xdr, StrKey } = StellarSdk;

/** Encode a symbol ScVal to base64 XDR (matches CAMPAIGN_TOPIC / ORDER_TOPIC constants). */
export function scvSymbolB64(s: string): string {
  return xdr.ScVal.scvSymbol(s).toXDR("base64");
}

/** Encode a Vec of string ScVals to base64 XDR. */
export function scvVecOfStringsB64(items: string[]): string {
  return xdr.ScVal.scvVec(items.map((i) => xdr.ScVal.scvString(Buffer.from(i)))).toXDR("base64");
}

export interface CampaignCreatedPayload {
  campaignId: string;
  farmer: string;
  token: string;
  targetAmount: string;
  deadline: string;
}

export interface CampaignInvestedPayload {
  campaignId: string;
  investor: string;
  amount: string;
  totalRaised: string;
}

/**
 * Build a raw event object the watcher hands to the parser for campaign.created.
 * `topic` elements are base64-encoded ScVal XDR strings, matching the Soroban wire format.
 */
export function makeCampaignCreatedRawEvent(
  p: CampaignCreatedPayload,
  ledger = 100,
  eventIdx = 0,
  contractId = "CTEST0000000000000000000000000000000000000000000000000000",
): object {
  return {
    id: `${ledger}-${eventIdx}`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    contractId,
    topic: [scvSymbolB64("campaign"), scvSymbolB64("created")],
    value: scvVecOfStringsB64([p.campaignId, p.farmer, p.token, p.targetAmount, p.deadline]),
    inSuccessfulContractCall: true,
    paging_token: `${ledger}-${eventIdx}`,
    txHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

/** Build a raw event for campaign.invested. */
export function makeCampaignInvestedRawEvent(
  p: CampaignInvestedPayload,
  ledger = 101,
  eventIdx = 0,
  contractId = "CTEST0000000000000000000000000000000000000000000000000000",
): object {
  return {
    id: `${ledger}-${eventIdx}`,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    contractId,
    topic: [scvSymbolB64("campaign"), scvSymbolB64("invested")],
    value: scvVecOfStringsB64([p.campaignId, p.investor, p.amount, p.totalRaised]),
    inSuccessfulContractCall: true,
    paging_token: `${ledger}-${eventIdx}`,
    txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
}

/**
 * Build the XDR entries needed for a mock getLedgerEntries (getAccount) response.
 * Returns { keyBase64, entryBase64 } for use in the mock RPC server.
 */
export function buildAccountLedgerEntry(
  publicKey: string,
  sequence = 100,
): { keyBase64: string; entryBase64: string } {
  const rawKey = StrKey.decodeEd25519PublicKey(publicKey);
  const accountId = xdr.PublicKey.publicKeyTypeEd25519(rawKey);

  const thresholds = Buffer.alloc(4);
  thresholds[0] = 1; // masterWeight

  // SequenceNumber is a typedef for Int64 in the XDR spec.
  const seqNum = xdr.Int64.fromString(sequence.toString());

  const accountEntry = new xdr.AccountEntry({
    accountId,
    balance: xdr.Int64.fromString("1000000000000"),
    seqNum,
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: "",
    thresholds,
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });

  const ledgerEntry = new xdr.LedgerEntry({
    lastModifiedLedgerSeq: 100,
    data: xdr.LedgerEntryData.account(accountEntry),
    ext: new xdr.LedgerEntryExt(0),
  });

  const ledgerKey = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId }),
  );

  return {
    keyBase64: ledgerKey.toXDR("base64"),
    entryBase64: ledgerEntry.toXDR("base64"),
  };
}

/**
 * Build a minimal SorobanTransactionData for the mock simulateTransaction response.
 * Uses SorobanDataBuilder to handle version-specific XDR differences automatically.
 */
export function buildSorobanTransactionData(): string {
  return new StellarSdk.SorobanDataBuilder().build().toXDR("base64");
}
