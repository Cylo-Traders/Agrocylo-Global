/**
 * The Stellar network this application talks to, and the helpers used to
 * compare it with the network a connected wallet actually reports (#1087).
 *
 * There is exactly one configured network per deployment. A wallet may be
 * connected to another one — most commonly mainnet when the app is configured
 * for testnet — and every signed transaction would then be built against the
 * wrong passphrase and fail (or worse, succeed against the wrong network).
 *
 * The rule this module encodes: an unverifiable network is *unknown*, never a
 * match. `compareNetworks(null)` returns `"unknown"`, so callers can block a
 * financial action instead of silently assuming the configured network.
 */

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** The network this deployment is configured for. */
export const EXPECTED_NETWORK_PASSPHRASE: string =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? TESTNET_PASSPHRASE;

/**
 * - `match` — the wallet reports the configured passphrase.
 * - `mismatch` — the wallet reports a different, known passphrase.
 * - `unknown` — the wallet could not report its network. This is deliberately
 *   distinct from `match`: treating an unreadable network as configured is the
 *   risky fallback that lets a wrong-network transaction start at all.
 */
export type NetworkComparison = "match" | "mismatch" | "unknown";

export function compareNetworks(
  walletPassphrase: string | null | undefined,
  expected: string = EXPECTED_NETWORK_PASSPHRASE,
): NetworkComparison {
  if (!walletPassphrase) return "unknown";
  return walletPassphrase === expected ? "match" : "mismatch";
}

/** Human-readable network name for badges, banners and error messages. */
export function networkName(passphrase: string | null | undefined): string {
  if (!passphrase) return "an unknown network";
  if (passphrase === MAINNET_PASSPHRASE) return "Mainnet";
  if (passphrase === TESTNET_PASSPHRASE) return "Testnet";
  return passphrase;
}
