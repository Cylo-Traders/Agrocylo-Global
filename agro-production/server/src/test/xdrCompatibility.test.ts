import { describe, expect, it } from 'vitest';
import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { buildAccountLedgerEntry } from '../e2e/helpers/xdrBuilder.js';

describe('SDK account ledger fixtures', () => {
  it('round-trips account keys and entries through the aligned SDK', () => {
    const key = Keypair.random();
    const fixture = buildAccountLedgerEntry(key.publicKey());
    const ledgerKey = xdr.LedgerKey.fromXDR(fixture.keyBase64, 'base64');
    expect(ledgerKey.type).toBe('account');
    if (ledgerKey.type !== 'account') throw new Error('Expected account key');
    expect(
      StrKey.encodeEd25519PublicKey(
        ledgerKey.account.accountId.ed25519.toBytes(),
      ),
    ).toBe(key.publicKey());
    const entry = xdr.LedgerEntry.fromXDR(fixture.entryBase64, 'base64');
    expect(entry.data.type).toBe('account');
    expect(entry.ext.type).toBe('v0');
  });
});
