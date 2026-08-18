import { apiPost } from "@/lib/apiHelper";

/**
 * Cross-app SSO handoff (Issue #648, hardened per #686). The token is minted
 * server-side (HMAC-signed via the shared JWT secret, 60s TTL, single-use) by
 * POST /auth/handoff and verified server-side by the agro-production app —
 * this module never signs or trusts an unsigned client-side token.
 */
export async function generateHandoffToken(): Promise<string | null> {
  try {
    const { token } = await apiPost<{ token: string }>("/auth/handoff", {});
    return token;
  } catch {
    return null;
  }
}

/** Appends the handoff token to a cross-app URL as a query param. */
export function buildHandoffUrl(baseUrl: string, token: string | null): string {
  if (!token) return baseUrl;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("handoff", token);
    return url.toString();
  } catch {
    return baseUrl;
  }
}
