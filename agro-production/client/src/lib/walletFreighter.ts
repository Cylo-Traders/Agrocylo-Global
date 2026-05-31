import FreighterApi from "@stellar/freighter-api";
import { getFreighterBridgeFromWindow } from "@/types/freighter";

export async function getFreighterPublicKey(): Promise<string | null> {
  const bridge = getFreighterBridgeFromWindow();
  const pub = bridge ? await bridge.getPublicKey() : await FreighterApi.getPublicKey();
  return pub || null;
}
