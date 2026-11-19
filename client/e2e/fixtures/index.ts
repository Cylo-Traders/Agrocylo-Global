import type { BrowserContext, Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";

const FARMER_ADDRESS =
  "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";
const BUYER_ADDRESS =
  "GBQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG5XYZ";

interface WalletMockOptions {
  address?: string;
  network?: string;
}

function freighterMockScript(options: WalletMockOptions = {}): string {
  const address = options.address ?? BUYER_ADDRESS;
  const network = options.network ?? "TESTNET";
  return `
    window.freighter = {
      isConnected:     () => Promise.resolve(true),
      getPublicKey:    () => Promise.resolve("${address}"),
      getNetwork:      () => Promise.resolve("${network}"),
      signTransaction: (xdr) => Promise.resolve({ signedTxXdr: xdr }),
    };
    window.freighterApi = window.freighter;
  `;
}

type FreighterLike = {
  signTransaction: (xdr: string) => Promise<{ signedTxXdr: string }>;
};

type WindowWithMocks = Window & {
  freighter: { signTransaction: FreighterLike["signTransaction"] };
  __originalFetch?: typeof fetch;
};

function apiMockScript(): string {
  return `
    window.__agrocyloMocks = {
      apiUnavailable: false,
      simulateNetworkError: (urlPattern) => {
        const origFetch = window.fetch;
        window.fetch = (...args) => {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
          if (url.includes(urlPattern)) {
            return Promise.reject(new TypeError('Failed to fetch'));
          }
          return origFetch.apply(window, args);
        };
      },
      resetFetch: () => {
        delete window.__agrocyloMocks.apiUnavailable;
      },
      rejectWalletSign: () => {
        window.freighter.signTransaction = () => Promise.reject(new Error('User rejected signature'));
      },
      restoreWalletSign: (address) => {
        window.freighter.signTransaction = (xdr) => Promise.resolve({ signedTxXdr: xdr });
      },
    };
  `;
}

interface E2EFixtures {
  walletMock: {
    connect: (page: Page, options?: WalletMockOptions) => Promise<void>;
    disconnect: (page: Page) => Promise<void>;
    rejectSignature: (page: Page) => Promise<void>;
    restoreSignature: (page: Page) => Promise<void>;
    FARMER_ADDRESS: string;
    BUYER_ADDRESS: string;
  };
  apiMock: {
    simulateBackendUnavailable: (page: Page) => Promise<void>;
    resetBackend: (page: Page) => Promise<void>;
  };
}

const FIXTURE_FARMER = FARMER_ADDRESS;
const FIXTURE_BUYER = BUYER_ADDRESS;

export const test = base.extend<E2EFixtures>({
  walletMock: [
    async ({}, use) => {
      const connect = async (page: Page, options: WalletMockOptions = {}) => {
        await page.addInitScript(freighterMockScript(options));
        await page.evaluate((address) => {
          localStorage.setItem("walletAddress", address);
          localStorage.setItem("walletNetwork", "Testnet");
        }, options.address ?? FIXTURE_BUYER);
      };

      const disconnect = async (page: Page) => {
        await page.evaluate(() => {
          localStorage.removeItem("walletAddress");
          localStorage.removeItem("walletNetwork");
        });
      };

      const rejectSignature = async (page: Page) => {
        await page.evaluate(() => {
          (window as unknown as WindowWithMocks).freighter.signTransaction = () =>
            Promise.reject(new Error("User rejected signature"));
        });
      };

      const restoreSignature = async (page: Page) => {
        const addr = FIXTURE_BUYER;
        await page.evaluate((address) => {
          ((window as unknown as WindowWithMocks).freighter.signTransaction) = (
            xdr: string,
          ) => Promise.resolve({ signedTxXdr: xdr });
        }, addr);
      };

      await use({
        connect,
        disconnect,
        rejectSignature,
        restoreSignature,
        FARMER_ADDRESS: FIXTURE_FARMER,
        BUYER_ADDRESS: FIXTURE_BUYER,
      });
    },
    { scope: "test" },
  ],

  apiMock: [
    async ({}, use) => {
      const simulateBackendUnavailable = async (page: Page) => {
        await page.evaluate(() => {
          const origFetch = window.fetch;
          window.fetch = (...args: Parameters<typeof fetch>) => {
            const url =
              typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
            if (url.includes("/api/") || url.includes("localhost")) {
              return Promise.reject(new TypeError("Failed to fetch"));
            }
            return origFetch.apply(window, args);
          };
        });
      };

      const resetBackend = async (page: Page) => {
        await page.evaluate(() => {
          const origFetch = (window as unknown as WindowWithMocks).__originalFetch;
          if (origFetch) {
            window.fetch = origFetch;
          }
        });
      };

      await use({ simulateBackendUnavailable, resetBackend });
    },
    { scope: "test" },
  ],
});

export { expect };
export { FIXTURE_FARMER as FARMER_ADDRESS, FIXTURE_BUYER as BUYER_ADDRESS };
