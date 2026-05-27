import FreighterApi from "@stellar/freighter-api";

type FreighterBridge = {
  getPublicKey: () => Promise<string>;
};

function getFreighterBridge(): FreighterBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    freighter?: FreighterBridge;
    freighterApi?: FreighterBridge;
  };

  if (w.freighter?.getPublicKey) return w.freighter;
  if (w.freighterApi?.getPublicKey) return w.freighterApi;
  return null;
}

export async function getFreighterPublicKey(): Promise<string | null> {
  const bridge = getFreighterBridge();
  const pub = bridge ? await bridge.getPublicKey() : await FreighterApi.getPublicKey();
  return pub || null;
}
