export interface FreighterSignTransaction {
  signTransaction(xdr: string, opts: { networkPassphrase: string }): Promise<string>;
}

export interface FreighterBridge extends FreighterSignTransaction {
  getPublicKey(): Promise<string>;
}

export function isFreighterBridge(value: unknown): value is FreighterBridge {
  if (typeof value !== "object" || value === null) return false;
  return "getPublicKey" in value && "signTransaction" in value;
}

export function hasFreighterSignTransaction(
  value: unknown,
): value is FreighterSignTransaction {
  if (typeof value !== "object" || value === null) return false;
  return "signTransaction" in value;
}

export function getFreighterBridgeFromWindow(): FreighterBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as { freighter?: unknown; freighterApi?: unknown };
  if (isFreighterBridge(w.freighter)) return w.freighter;
  if (isFreighterBridge(w.freighterApi)) return w.freighterApi;
  return null;
}

export function getFreighterSignerFromWindow(): FreighterSignTransaction | null {
  if (typeof window === "undefined") return null;
  const w = window as { freighter?: unknown; freighterApi?: unknown };
  if (hasFreighterSignTransaction(w.freighter)) return w.freighter;
  if (hasFreighterSignTransaction(w.freighterApi)) return w.freighterApi;
  return null;
}
