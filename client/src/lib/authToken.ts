// NOTE: Tokens stored in localStorage are vulnerable to XSS attacks. This is a known tradeoff
// accepted during development. For production, migrate to httpOnly Secure cookies set by the
// backend. See https://github.com/Agrocylo-Global/agrocylo-app/issues/815 for details.
// Mitigations: CSP headers configured in next.config.ts, short token lifetime recommended.

export const AUTH_TOKEN_STORAGE_KEY = "agrocylo:access-token";

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
