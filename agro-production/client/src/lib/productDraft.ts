// Wallet-scoped, browser-local draft persistence for the product listing form.
// Only text fields are persisted; image blobs/files are never stored.

export interface ProductDraftFields {
  name: string;
  description: string;
  price: string;
  quantity: string;
  unit: string;
  category: string;
  location: string;
}

export interface ProductDraft {
  wallet: string;
  fields: ProductDraftFields;
  updatedAt: number;
}

const STORAGE_PREFIX = "agro:product-draft:";

function normalizeWallet(wallet: string | null | undefined): string | null {
  if (!wallet) return null;
  const trimmed = wallet.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function storageKey(wallet: string): string {
  return `${STORAGE_PREFIX}${wallet}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Persist the text fields of a product form draft for a specific wallet.
 * Returns false when there is no wallet or storage is unavailable.
 */
export function saveProductDraft(
  wallet: string | null | undefined,
  fields: ProductDraftFields
): boolean {
  const normalized = normalizeWallet(wallet);
  const storage = getStorage();
  if (!normalized || !storage) return false;

  const draft: ProductDraft = {
    wallet: normalized,
    fields,
    updatedAt: Date.now(),
  };

  try {
    storage.setItem(storageKey(normalized), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a previously saved draft for the given wallet, or null if none exists.
 */
export function loadProductDraft(
  wallet: string | null | undefined
): ProductDraft | null {
  const normalized = normalizeWallet(wallet);
  const storage = getStorage();
  if (!normalized || !storage) return null;

  try {
    const raw = storage.getItem(storageKey(normalized));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProductDraft;
    if (!parsed || typeof parsed !== "object" || !parsed.fields) return null;
    // Guard against cross-wallet leakage from a corrupted or tampered entry.
    if (normalizeWallet(parsed.wallet) !== normalized) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove the saved draft for the given wallet.
 */
export function clearProductDraft(wallet: string | null | undefined): void {
  const normalized = normalizeWallet(wallet);
  const storage = getStorage();
  if (!normalized || !storage) return;

  try {
    storage.removeItem(storageKey(normalized));
  } catch {
    // Ignore storage failures; discarding is best-effort.
  }
}

/**
 * Whether a non-empty draft exists for the given wallet.
 */
export function hasProductDraft(wallet: string | null | undefined): boolean {
  return loadProductDraft(wallet) !== null;
}
