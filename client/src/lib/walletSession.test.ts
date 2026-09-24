import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletAdapter } from "./walletAdapters";
import { authenticateWallet, logoutWalletSession } from "./walletSession";
import { getAccessToken, setAuthSession } from "./authToken";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function adapter(
  signMessage = vi.fn().mockResolvedValue("signed-base64"),
): WalletAdapter {
  return {
    id: "test",
    name: "Test wallet",
    icon: "",
    isAvailable: () => true,
    supportsMobile: () => true,
    mobileDeepLink: () => null,
    getPublicKey: vi.fn().mockResolvedValue(ADDRESS),
    getNetwork: vi.fn().mockResolvedValue("TESTNET"),
    signMessage,
  };
}

describe("wallet backend session", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("completes nonce signing and verification before storing credentials", async () => {
    const signer = vi.fn().mockResolvedValue("signed-base64");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Sign this challenge",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "access-token",
            refreshToken: "refresh-token",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await authenticateWallet(adapter(signer), ADDRESS);

    expect(signer).toHaveBeenCalledWith("Sign this challenge", ADDRESS);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/auth/nonce");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/auth/verify");
    expect(getAccessToken()).toBe("access-token");
  });

  it("stores no credential when signature approval is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: "Sign this challenge",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      authenticateWallet(
        adapter(vi.fn().mockRejectedValue(new Error("User rejected"))),
        ADDRESS,
      ),
    ).rejects.toThrow("User rejected");
    expect(getAccessToken()).toBeNull();
  });

  it("rejects an expired challenge without requesting a signature", async () => {
    const signer = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: "Expired challenge",
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(authenticateWallet(adapter(signer), ADDRESS)).rejects.toThrow(
      "expired",
    );
    expect(signer).not.toHaveBeenCalled();
  });

  it("clears local credentials before sending logout", async () => {
    setAuthSession(ADDRESS, "access-token", "refresh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await logoutWalletSession();

    expect(getAccessToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
