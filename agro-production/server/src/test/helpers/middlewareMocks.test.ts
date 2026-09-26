import { describe, it, expect, vi } from 'vitest';
import * as rateLimit from '../../middleware/rateLimit.js';
import * as walletAuth from '../../middleware/walletAuth.js';
import {
  createRateLimitMock,
  createWalletAuthMock,
} from './middlewareMocks.js';

/**
 * Guard for issue #1063.
 *
 * A partial `vi.mock()` factory silently turns a whole suite into zero tests
 * ("No authLimiter export is defined on the ../middleware/rateLimit.js mock").
 * These assertions fail at the source instead: whenever a new export is added
 * to a middleware module, the shared mock must grow with it.
 */
describe('shared middleware mocks', () => {
  it('covers every export of middleware/rateLimit.ts', () => {
    const mock = createRateLimitMock();
    for (const exportName of Object.keys(rateLimit)) {
      expect(
        Object.keys(mock),
        `missing mock for rateLimit export "${exportName}"`,
      ).toContain(exportName);
    }
  });

  it('covers every export of middleware/walletAuth.ts', () => {
    const mock = createWalletAuthMock();
    for (const exportName of Object.keys(walletAuth)) {
      if (exportName === 'WalletRequest') continue;
      expect(
        Object.keys(mock),
        `missing mock for walletAuth export "${exportName}"`,
      ).toContain(exportName);
    }
  });

  it('represents authLimiter explicitly', () => {
    expect(createRateLimitMock()).toHaveProperty('authLimiter');
  });

  it('passes control to the next handler for every limiter', () => {
    const next = vi.fn();
    for (const limiter of Object.values(createRateLimitMock())) {
      limiter({} as never, {} as never, next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });
});
