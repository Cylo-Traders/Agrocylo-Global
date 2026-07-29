/**
 * Utility for generating signed/timestamped SSO handoff tokens
 * for cross-app navigation between root client and agro-production client (Issue #648)
 */
export function generateHandoffToken(walletAddress: string): string {
  const payload = {
    wallet: walletAddress,
    ts: Date.now(),
    app: "agrocylo-root",
  };
  return btoa(JSON.stringify(payload));
}

export function parseHandoffToken(token: string): { wallet: string; ts: number } | null {
  try {
    const decoded = JSON.parse(atob(token));
    if (decoded && decoded.wallet && typeof decoded.ts === "number") {
      // Token valid for 10 minutes
      if (Date.now() - decoded.ts < 10 * 60 * 1000) {
        return decoded;
      }
    }
  } catch {
    // Invalid token
  }
  return null;
}
