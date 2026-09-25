declare module "*.css";

/**
 * Direct browser-extension Freighter API.
 *
 * Two access patterns exist on the window object:
 *  - `window.freighter` — used by the Freighter browser extension itself
 *  - `window.freighterApi` — used by Playwright e2e mocks (and some older tests)
 *
 * Production code should prefer `@stellar/freighter-api`. These globals are
 * only consulted when the npm package can't reach the extension (e.g. in
 * headless test contexts) or when test-mode is detected.
 */
interface FreighterDirect {
  getPublicKey: () => Promise<string>;
  getNetwork: () => Promise<string>;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; accountToSign?: string },
  ) => Promise<string>;
  signMessage?: (
    message: string,
    opts?: { address?: string; networkPassphrase?: string },
  ) => Promise<string | { signedMessage: string }>;
}

declare global {
  interface Window {
    freighter?: FreighterDirect;
    freighterApi?: FreighterDirect;
  }
}

export {};
