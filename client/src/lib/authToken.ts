// NOTE: Tokens stored in localStorage are vulnerable to XSS attacks. This is a known tradeoff
// accepted during development. For production, migrate to httpOnly Secure cookies set by the
// backend. See https://github.com/Agrocylo-Global/agrocylo-app/issues/815 for details.
// Mitigations: CSP headers configured in next.config.ts, short token lifetime recommended.

export const AUTH_TOKEN_STORAGE_KEY = "agrocylo:access-token";
export const REFRESH_TOKEN_STORAGE_KEY = "agrocylo:refresh-token";
export const AUTH_WALLET_STORAGE_KEY = "agrocylo:session-wallet";
export const AUTH_EXPIRED_EVENT = "agrocylo:auth-expired";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
}

export function setAuthSession(
  walletAddress: string,
  accessToken: string,
  refreshToken: string,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  window.localStorage.setItem(AUTH_WALLET_STORAGE_KEY, walletAddress);
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_WALLET_STORAGE_KEY);
}

export function hasValidAccessToken(walletAddress: string): boolean {
  if (typeof window === "undefined") return false;
  const token = getAccessToken();
  const storedWallet = window.localStorage.getItem(AUTH_WALLET_STORAGE_KEY);
  if (!token || storedWallet?.toLowerCase() !== walletAddress.toLowerCase())
    return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as {
      walletAddress?: string;
      exp?: number;
    };
    return (
      payload.walletAddress?.toLowerCase() === walletAddress.toLowerCase() &&
      typeof payload.exp === "number" &&
      payload.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}
