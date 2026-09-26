import type { Request, RequestHandler } from 'express';

/**
 * Centralised Express middleware mocks for route-level suites (issue #1063).
 *
 * Route tests mount the whole `app.ts` graph, which pulls in every middleware
 * module. A partial `vi.mock()` factory that forgets a newly added export makes
 * the suite fail to collect with
 * `No "<export>" export is defined on the "<module>" mock`, i.e. a zero-test
 * suite that only surfaces when the middleware changes.
 *
 * Keeping the shapes here means a new limiter is added in one place, and
 * `middlewareMocks.test.ts` fails loudly when a real export has no mock.
 */

/** No-op Express middleware: hands control straight to the next handler. */
export const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

/**
 * Canonical mock for `src/middleware/rateLimit.ts`.
 *
 * `defaultLimiter`, `writeLimiter` and `authLimiter` must all be present:
 * `app.ts` imports `defaultLimiter` globally and `routes/auth.ts` imports
 * `authLimiter` at module scope, so a missing export breaks collection even for
 * suites that never touch an auth route.
 */
export function createRateLimitMock(): Record<string, RequestHandler> {
  return {
    defaultLimiter: passThrough,
    writeLimiter: passThrough,
    authLimiter: passThrough,
  };
}

/**
 * Canonical mock for `src/middleware/walletAuth.ts` that trusts the
 * `x-wallet-address` header. Suites that exercise real signature verification
 * should not use this.
 */
export function createWalletAuthMock(): Record<string, RequestHandler> {
  const requireWallet: RequestHandler = (req, res, next) => {
    const header = req.header('x-wallet-address');
    if (!header) {
      res.status(401).json({ message: 'Missing x-wallet-address header.' });
      return;
    }
    (req as Request & { walletAddress?: string }).walletAddress = header;
    next();
  };

  return { requireWallet };
}
