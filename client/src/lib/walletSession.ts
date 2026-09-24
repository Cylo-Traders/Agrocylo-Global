import { API_BASE_URL } from "./apiConfig";
import { clearAuthSession, getRefreshToken, setAuthSession } from "./authToken";
import type { WalletAdapter } from "./walletAdapters";

interface NonceResponse {
  message: string;
  expiresAt: string;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let message = `Sign-in failed (${response.status})`;
  try {
    const body = (await response.json()) as {
      detail?: string;
      message?: string;
      title?: string;
    };
    message = body.detail ?? body.message ?? body.title ?? message;
  } catch {
    // Keep the status-based message for non-JSON responses.
  }
  throw new Error(message);
}

export async function authenticateWallet(
  adapter: WalletAdapter,
  walletAddress: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!adapter.signMessage) {
    throw new Error(
      `${adapter.name} cannot sign the login challenge yet. Connect with an updated Freighter wallet.`,
    );
  }

  const challenge = await readJson<NonceResponse>(
    await fetch(`${API_BASE_URL}/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress }),
      signal,
    }),
  );
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    throw new Error("The sign-in challenge expired. Try signing in again.");
  }

  const signature = await adapter.signMessage(challenge.message, walletAddress);
  if (signal?.aborted)
    throw new DOMException("Sign-in cancelled", "AbortError");

  const tokens = await readJson<TokenResponse>(
    await fetch(`${API_BASE_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress,
        signature,
        message: challenge.message,
      }),
      signal,
    }),
  );
  setAuthSession(walletAddress, tokens.accessToken, tokens.refreshToken);
}

export async function logoutWalletSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearAuthSession();
  if (!refreshToken) return;
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // Local credentials are already gone; remote expiry remains the fallback.
  }
}
