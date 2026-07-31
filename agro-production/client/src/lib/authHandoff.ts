import api from "./apiClient";

/**
 * Cross-app SSO handoff (Issue #648, hardened per #686). Consumes a
 * single-use, signed token minted by the root app's POST /auth/handoff and
 * exchanges it for a session on this app via the wallet auth service.
 */
export interface HandoffSession {
  accessToken: string;
  sessionToken: string;
  walletAddress: string;
  expiresAt: string;
}

export async function consumeHandoffToken(token: string): Promise<HandoffSession | null> {
  try {
    return await api.post<HandoffSession>("/auth/handoff", { token });
  } catch {
    return null;
  }
}
