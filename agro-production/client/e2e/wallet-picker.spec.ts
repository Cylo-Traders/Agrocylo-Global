import { expect, test, type Page } from "@playwright/test";

/**
 * Wallet-picker coverage (Issue #944 / multi-wallet migration).
 *
 * The real Stellar Wallets Kit talks to injected providers over `postMessage`
 * (Freighter) or an injected global. Rather than adding a test hook to
 * production code, each test installs a provider fixture into the page with
 * `addInitScript`, so the picker, the kit, and the session layer all run for
 * real. Only public-key-shaped fixtures are used: no keys, signed XDR,
 * tokens, or other sensitive material.
 */

const PUBLIC_KEY = `G${"A".repeat(55)}`;
const SESSION_KEY = "ap_walletSession";

/** Shape of the message protocol freighter-api 6 speaks. */
type ProviderBehaviour =
  | { mode: "connected"; address: string }
  | { mode: "reject-access"; message: string }
  | { mode: "silent" };

async function installProviderFixture(
  page: Page,
  behaviour: ProviderBehaviour,
): Promise<void> {
  await page.addInitScript((config: ProviderBehaviour) => {
    const respond = (request: { messageId?: string; type?: string }, payload: Record<string, unknown>) => {
      window.postMessage(
        {
          source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
          messagedId: request.messageId,
          ...payload,
        },
        window.location.origin,
      );
    };

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window) return;
      const request = event.data as { source?: string; messageId?: string; type?: string };
      if (request?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;

      switch (request.type) {
        case "REQUEST_CONNECTION_STATUS":
          respond(request, { isConnected: config.mode === "connected" });
          break;
        case "REQUEST_ACCESS":
          if (config.mode === "reject-access") {
            respond(request, { publicKey: "", apiError: config.message });
          } else if (config.mode === "connected") {
            respond(request, { publicKey: config.address });
          }
          break;
        case "REQUEST_PUBLIC_KEY":
          respond(request, { publicKey: config.mode === "connected" ? config.address : "" });
          break;
        case "REQUEST_NETWORK_DETAILS":
          respond(request, {
            networkDetails: {
              network: "TESTNET",
              networkName: "Test SDF Network",
              networkUrl: "https://soroban-testnet.stellar.org",
              networkPassphrase: "Test SDF Network ; September 2015",
            },
          });
          break;
        case "REQUEST_ALLOWED_STATUS":
          respond(request, { isAllowed: config.mode === "connected" });
          break;
        default:
          // "silent" fixtures answer nothing, which is how a missing or
          // unreachable provider behaves.
          break;
      }
    });
  }, behaviour);
}

async function readSession(page: Page): Promise<{ address: string; walletId?: string } | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, SESSION_KEY);
}

async function openWalletPicker(page: Page) {
  await page.goto("/home");
  await page.getByRole("button", { name: "Choose a wallet" }).click();
  await expect(page.getByRole("menu", { name: "Stellar wallets" })).toBeVisible();
}

test.describe("wallet picker", () => {
  test("connects an available provider, shows the address, and persists the selection", async ({
    page,
  }) => {
    await installProviderFixture(page, { mode: "connected", address: PUBLIC_KEY });
    await openWalletPicker(page);

    await page.getByRole("menuitem", { name: /Connect Freighter/ }).click();

    await expect(page.getByRole("button", { name: "Disconnect wallet" })).toBeVisible();
    await expect(page.getByLabel(`Connected wallet: ${PUBLIC_KEY}`)).toBeVisible();
    expect(await readSession(page)).toEqual({
      address: PUBLIC_KEY,
      walletId: "freighter",
      connectedAt: expect.any(Number),
    });
  });

  test("surfaces a provider rejection without persisting a session", async ({ page }) => {
    await installProviderFixture(page, {
      mode: "reject-access",
      message: "The user declined the access request.",
    });
    await openWalletPicker(page);

    await page.getByRole("menuitem", { name: /Connect Freighter/ }).click();

    await expect(page.getByRole("alert")).toContainText(/declined/i);
    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    expect(await readSession(page)).toBeNull();
  });

  test("offers an install path for a provider that is unavailable", async ({ page }) => {
    await installProviderFixture(page, { mode: "silent" });
    await openWalletPicker(page);

    const installLink = page.getByRole("menuitem", { name: /Install or open Freighter/ });
    await expect(installLink).toHaveAttribute("href", "https://freighter.app");

    await installLink.click();
    await expect(page.getByRole("alert")).toContainText(/Freighter is unavailable/i);
    expect(await readSession(page)).toBeNull();
  });

  test("restores a persisted selection after a refresh without a new permission prompt", async ({
    page,
  }) => {
    await installProviderFixture(page, { mode: "connected", address: PUBLIC_KEY });
    await openWalletPicker(page);
    await page.getByRole("menuitem", { name: /Connect Freighter/ }).click();
    await expect(page.getByRole("button", { name: "Disconnect wallet" })).toBeVisible();

    const accessRequests: string[] = [];
    await page.exposeFunction("recordAccessRequest", (type: string) => {
      accessRequests.push(type);
    });
    await page.addInitScript(() => {
      window.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { source?: string; type?: string };
        if (data?.source === "FREIGHTER_EXTERNAL_MSG_REQUEST" && data.type === "REQUEST_ACCESS") {
          (window as unknown as { recordAccessRequest: (type: string) => void }).recordAccessRequest(
            data.type,
          );
        }
      });
    });

    await page.reload();

    await expect(page.getByRole("button", { name: "Disconnect wallet" })).toBeVisible();
    await expect(page.getByLabel(`Connected wallet: ${PUBLIC_KEY}`)).toBeVisible();
    expect(accessRequests).toEqual([]);
  });

  test("drops a persisted session when the provider is gone", async ({ page }) => {
    await page.goto("/home");
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key!, value!),
      [
        SESSION_KEY,
        JSON.stringify({
          address: PUBLIC_KEY,
          connectedAt: Date.now(),
          walletId: "freighter",
        }),
      ],
    );
    await installProviderFixture(page, { mode: "silent" });
    await page.reload();

    await expect(page.getByRole("button", { name: "Connect wallet" })).toBeVisible();
    expect(await readSession(page)).toBeNull();
  });
});
