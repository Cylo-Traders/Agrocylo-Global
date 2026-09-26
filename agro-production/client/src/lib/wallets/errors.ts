/**
 * Wallet-error vocabulary.
 *
 * Provider names live in the wallet layer only. Feature code classifies an
 * unknown error as a wallet problem by calling `isWalletError`, so nothing
 * outside `lib/wallets` needs to know which providers are enabled.
 */

/**
 * Substrings that identify a wallet rejection/permission failure. Kept
 * deliberately broad: the kit wraps each provider's own error text, and
 * providers name themselves inconsistently.
 */
const WALLET_ERROR_MARKERS = [
  "wallet",
  "user declined",
  "user rejected",
  "user cancelled",
  "user canceled",
  "rejected by",
  "declined by",
  "permission",
  "not installed",
  "no wallet",
  "is not available",
  "extension",
  "connection request",
  "transport",
  "modal closed",
  "closed the modal",
] as const;

export class WalletRejectionError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = "WalletRejectionError";
    this.providerId = providerId;
  }
}

export function isWalletError(error: unknown, fallbackMessage?: string): boolean {
  if (error instanceof WalletRejectionError) return true;

  const raw =
    fallbackMessage ??
    (error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error));
  const message = raw.toLowerCase();

  return WALLET_ERROR_MARKERS.some((marker) => message.includes(marker));
}
