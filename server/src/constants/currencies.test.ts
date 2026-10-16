import { describe, expect, it } from 'vitest';
import { assertCurrency, fromBaseUnits, toBaseUnits } from './currencies.js';

describe('currencies (#1135)', () => {
  it('accepts XLM and USDC, normalising case', () => {
    expect(assertCurrency('XLM')).toBe('XLM');
    expect(assertCurrency('usdc')).toBe('USDC');
  });

  it.each(['BTC', '', undefined, 42, 'STRK'])('rejects %s with 400', (v) => {
    expect(() => assertCurrency(v)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('allows legacy STRK only when asked', () => {
    expect(assertCurrency('STRK', { allowLegacy: true })).toBe('STRK');
  });

  it('converts XLM and USDC to 7-decimal base units and back', () => {
    expect(toBaseUnits('1.5', 'XLM')).toBe(15_000_000n);
    expect(toBaseUnits('100', 'USDC')).toBe(1_000_000_000n);
    expect(fromBaseUnits(15_000_000n, 'XLM')).toBe('1.5');
    expect(fromBaseUnits(1_000_000_000n, 'USDC')).toBe('100');
    expect(fromBaseUnits(1n, 'XLM')).toBe('0.0000001');
  });

  it('rejects too many decimals and malformed amounts', () => {
    expect(() => toBaseUnits('0.00000001', 'XLM')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => toBaseUnits('-1', 'USDC')).toThrow(expect.objectContaining({ status: 400 }));
  });
});
