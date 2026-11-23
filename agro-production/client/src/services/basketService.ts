/**
 * Investor basket service (Issue #1050)
 *
 * Connects the basket page to the existing server basket read model:
 *   GET {API}/investor/basket (wallet-scoped, Authorization: Bearer via ApiClient)
 *
 * Units contract:
 *   - The server returns Soroban i128 **stroop** strings exactly as indexed
 *     (1 XLM = 10_000_000 stroops). They must never travel through `Number`
 *     — conversion happens through the exact BigInt helpers in
 *     `lib/validation` only.
 *   - The view model below converts to XLM `formatStroopsForDisplay` strings
 *     (whole + 7 fractional digits, i128-exact); display formatting (dp)
 *     happens at render time.
 *   - `weight` is a plain 0–100 number: integer percentage of the basket's
 *     total allocation this position represents.
 */

import api, { isApiError, isNetworkError } from "../lib/apiClient";
import { formatStroopsForDisplay } from "../lib/validation";

/** Server shape — mirrors InvestorBasketSummarySchema (stroops, i128 strings). */
export interface InvestorBasketPositionDTO {
  basketId: string;
  onChainId: string;
  depositorAddress: string;
  amount: string;
  claimed: boolean;
  withdrawn: boolean;
  payoutAmount?: string | null;
  ledger: number;
  txHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvestorBasketSummaryDTO {
  basket: {
    id: string;
    onChainId: string;
    constituentsCount: number;
    totalDeposited: string;
    status: "OPEN" | "FUNDED";
    createdAt: string;
    updatedAt: string;
  };
  positions: InvestorBasketPositionDTO[];
  totalAllocated: string;
  totalReturned: string;
}

/** Documented view model consumed by the basket page — amounts in XLM. */
export interface BasketPosition {
  campaignId: string;
  campaignName: string;
  /** Position allocation in XLM, 7-dp exact string derived from stroops. */
  allocatedAmount: string;
  /** Realized payout in XLM ("" while unclaimed). */
  currentValue: string;
  /** 0–100 integer share of the basket's total allocation. */
  weight: number;
  claimed: boolean;
}

export interface BasketSummary {
  basketId: string;
  onChainId: string;
  basketStatus: "OPEN" | "FUNDED";
  /** Total allocated across positions, XLM exact string. */
  totalAllocated: string;
  /** Claimed payouts, XLM exact string. */
  totalReturned: string;
  positions: BasketPosition[];
}

export type BasketState =
  | { kind: "empty" }
  | { kind: "unauthorized" }
  | { kind: "not_found" }
  | { kind: "offline" }
  | { kind: "error"; message: string };

/**
 * Cart quantity/stock constraints (Issue #1395).
 *
 * The server remains authoritative for stock. These helpers let the cart
 * controls show the product unit, block increments beyond known stock, and
 * surface server-side stock adjustments with a clear message.
 */
export interface CartStockInfo {
  /** Known available stock; `null` means unlimited/unknown. */
  availableStock: number | null;
  /** Product unit label (e.g. "kg", "crate"). */
  unit: string;
}

/** True when the requested quantity exceeds known available stock. */
export function exceedsAvailableStock(
  quantity: number,
  availableStock: number | null,
): boolean {
  if (availableStock === null) return false;
  return quantity > availableStock;
}

/**
 * Clamp a requested quantity to known stock. Unlimited stock (`null`) is
 * passed through unchanged; the minimum is always 1.
 */
export function clampToAvailableStock(
  quantity: number,
  availableStock: number | null,
): number {
  const floored = Math.max(1, Math.floor(quantity));
  if (availableStock === null) return floored;
  return Math.min(floored, Math.max(1, availableStock));
}

/** Format a cart quantity together with the product unit. */
export function formatCartQuantity(quantity: number, unit: string): string {
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${quantity} ${trimmedUnit}` : `${quantity}`;
}

/**
 * Build a clear adjustment message when the server returns an authoritative
 * quantity that differs from what the buyer submitted (e.g. stock changed).
 * Returns `null` when no adjustment is needed.
 */
export function describeStockAdjustment(
  requested: number,
  authoritative: number,
  unit: string,
): string | null {
  if (requested === authoritative) return null;
  return `Stock changed — quantity adjusted to ${formatCartQuantity(
    authoritative,
    unit,
  )}.`;
}

/**
 * Map a server summary to the documented view model. Positions are keyed by
 * deposit; the basket is a diversified set of campaign investments, so the
 * display name and campaign link reuse the on-chain basket id ("Campaign
 * <onChainId>") rather than inventing per-position campaign fields the
 * server does not index.
 */
export function mapInvestorBasket(dto: InvestorBasketSummaryDTO): BasketSummary {
  const allocated = BigInt(dto.totalAllocated || "0");
  const returned = BigInt(dto.totalReturned || "0");
  const safeAllocated = allocated > 0n ? allocated : 1n;

  const positions = dto.positions.map((position) => {
    const positionAllocated = BigInt(position.amount || "0");
    const positionReturned =
      position.claimed && position.payoutAmount ? BigInt(position.payoutAmount) : 0n;
    void positionReturned;
    return {
      campaignId: position.basketId,
      campaignName: `Basket ${position.onChainId}`,
      allocatedAmount: formatStroopsForDisplay(position.amount, 7),
      currentValue:
        position.claimed && position.payoutAmount
          ? formatStroopsForDisplay(position.payoutAmount, 7)
          : formatStroopsForDisplay(position.amount, 7),
      weight: Number((positionAllocated * 100n) / safeAllocated), // amount-exact-ok
      claimed: position.claimed,
    };
  });

  return {
    basketId: dto.basket.id,
    onChainId: dto.basket.onChainId,
    basketStatus: dto.basket.status,
    totalAllocated: formatStroopsForDisplay(dto.totalAllocated, 7),
    totalReturned: formatStroopsForDisplay(dto.totalReturned, 7),
    positions,
  };
}

/**
 * Fetch the wallet-scoped basket summary. Returns null when the investor has
 * no basket (server 404); unauthorized, offline and server failures propagate
 * as ApiError/NetworkError so the page can render its distinct states.
 */
export async function fetchInvestorBasket(): Promise<BasketSummary | null> {
  try {
    const dto = await api.get<InvestorBasketSummaryDTO>("/investor/basket");
    return mapInvestorBasket(dto);
  } catch (err) {
    if (isApiError(err) && err.status === 404) return null;
    throw err;
  }
}
