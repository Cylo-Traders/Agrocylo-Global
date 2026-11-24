import { describe, expect, it } from 'vitest';
import { canIncludeUnavailable } from './productVisibility.js';

describe('canIncludeUnavailable (#1427)', () => {
  it('is false when the flag was not requested', () => {
    expect(canIncludeUnavailable({ requested: false, walletAddress: 'gfarmer', role: 'ADMIN' })).toBe(
      false
    );
    expect(canIncludeUnavailable({ requested: undefined, walletAddress: 'gfarmer' })).toBe(false);
  });

  it('never honours it for an anonymous caller', () => {
    expect(canIncludeUnavailable({ requested: true })).toBe(false);
    expect(canIncludeUnavailable({ requested: true, farmer: 'gfarmer' })).toBe(false);
    expect(canIncludeUnavailable({ requested: true, role: 'ADMIN' })).toBe(false);
  });

  it('honours it for an admin session, with or without a farmer filter', () => {
    expect(canIncludeUnavailable({ requested: true, walletAddress: 'gadmin', role: 'ADMIN' })).toBe(
      true
    );
    expect(
      canIncludeUnavailable({
        requested: true,
        walletAddress: 'gadmin',
        role: 'admin',
        farmer: 'gother',
      })
    ).toBe(true);
  });

  it('honours it for a farmer asking for their own products only', () => {
    const base = { requested: true, walletAddress: 'GFarmer', role: 'FARMER' };
    expect(canIncludeUnavailable({ ...base, farmer: 'gfarmer' })).toBe(true);
    expect(canIncludeUnavailable({ ...base, farmer: 'gsomeoneelse' })).toBe(false);
    expect(canIncludeUnavailable({ ...base })).toBe(false);
    expect(canIncludeUnavailable({ ...base, farmer: '' })).toBe(false);
  });

  it('does not let a buyer see unavailable products', () => {
    expect(
      canIncludeUnavailable({ requested: true, walletAddress: 'gbuyer', role: 'BUYER' })
    ).toBe(false);
  });
});
