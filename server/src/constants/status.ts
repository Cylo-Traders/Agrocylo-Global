/**
 * Canonical on-chain ↔ DB status enums.
 *
 * Single source of truth for every status literal in the codebase.
 * Grep should find no raw status strings outside this module except
 * the definitions here and legacy migration SQL.
 *
 * DB values are UPPER_CASE, matching blockchainEventPersistenceService.projectEntity.
 * Contract numeric enums are mapped via the helpers below.
 */

// ---------------------------------------------------------------------------
// Order statuses (escrow + production_escrow)
// ---------------------------------------------------------------------------

export const OrderStatus = {
  PENDING: "PENDING",
  DELIVERED: "DELIVERED", // event-only, not distinct on-chain; DB intermediate
  COMPLETED: "COMPLETED",
  REFUNDED: "REFUNDED",
  DISPUTED: "DISPUTED",
  CANCELLED: "CANCELLED",
} as const;

export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

// Production variant uses PENDING→CONFIRMED instead of COMPLETED,
// but DB is normalized to PENDING/COMPLETED/REFUNDED/DISPUTED/CANCELLED
// via fromContractOrderStatus below.

export const ORDER_STATUS_MAP_ESCROW: Record<number, OrderStatusType> = {
  0: OrderStatus.PENDING,
  1: OrderStatus.DISPUTED,
  2: OrderStatus.COMPLETED,
  3: OrderStatus.REFUNDED,
};

export const ORDER_STATUS_MAP_PRODUCTION: Record<number, OrderStatusType> = {
  0: OrderStatus.PENDING,
  1: OrderStatus.COMPLETED, // Confirmed in production contract
  2: OrderStatus.REFUNDED,
};

export function fromContractOrderStatus(
  value: number | string,
  contractSet: "escrow" | "production_escrow" = "escrow",
): string {
  const num = Number(value);
  if (contractSet === "production_escrow") {
    return ORDER_STATUS_MAP_PRODUCTION[num] ?? String(value);
  }
  return ORDER_STATUS_MAP_ESCROW[num] ?? String(value);
}

// ---------------------------------------------------------------------------
// Campaign statuses
// ---------------------------------------------------------------------------

export const CampaignStatus = {
  ACTIVE: "ACTIVE",
  SETTLED: "SETTLED",
  FUNDING: "FUNDING",
  FUNDED: "FUNDED",
  IN_PRODUCTION: "IN_PRODUCTION",
  HARVESTED: "HARVESTED",
  FAILED: "FAILED",
  DISPUTED: "DISPUTED",
} as const;

export type CampaignStatusType = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const CAMPAIGN_STATUS_MAP_ESCROW: Record<number, CampaignStatusType> = {
  0: CampaignStatus.ACTIVE,
  1: CampaignStatus.SETTLED,
};

export const CAMPAIGN_STATUS_MAP_PRODUCTION: Record<number, CampaignStatusType> = {
  0: CampaignStatus.FUNDING,
  1: CampaignStatus.FUNDED,
  2: CampaignStatus.IN_PRODUCTION,
  3: CampaignStatus.HARVESTED,
  4: CampaignStatus.SETTLED,
  5: CampaignStatus.FAILED,
  6: CampaignStatus.DISPUTED,
};

export function fromContractCampaignStatus(
  value: number | string,
  contractSet: "escrow" | "production_escrow" = "escrow",
): string {
  const num = Number(value);
  if (contractSet === "production_escrow") {
    return CAMPAIGN_STATUS_MAP_PRODUCTION[num] ?? String(value);
  }
  return CAMPAIGN_STATUS_MAP_ESCROW[num] ?? String(value);
}

// ---------------------------------------------------------------------------
// Dispute statuses
// ---------------------------------------------------------------------------

export const DisputeStatus = {
  OPEN: "OPEN",
  IN_REVIEW: "IN_REVIEW",
  EVIDENCE_SUBMITTED: "EVIDENCE_SUBMITTED",
  RESOLVED: "RESOLVED",
  RESOLVED_BUYER: "RESOLVED_BUYER",
  RESOLVED_SELLER: "RESOLVED_SELLER",
  DISMISSED: "DISMISSED",
} as const;

export type DisputeStatusType = (typeof DisputeStatus)[keyof typeof DisputeStatus];

// ---------------------------------------------------------------------------
// Helpers for normalization & queries
// ---------------------------------------------------------------------------

/** All order statuses that are considered open/reconcilable. */
export const OPEN_ORDER_STATUSES: readonly OrderStatusType[] = [
  OrderStatus.PENDING,
  OrderStatus.DELIVERED,
  OrderStatus.DISPUTED,
] as const;

/** All campaign statuses that are considered active/reconcilable in escrow (legacy). */
export const ACTIVE_CAMPAIGN_STATUSES_ESCROW: readonly CampaignStatusType[] = [
  CampaignStatus.ACTIVE,
  CampaignStatus.FUNDING,
  CampaignStatus.FUNDED,
  CampaignStatus.IN_PRODUCTION,
  CampaignStatus.HARVESTED,
] as const;

export function normalizeOrderStatus(dbStatus: string): string {
  // Historical rows may be title-case or mixed; normalize to upper (canonical).
  // "Delivered" is event-only on DB but maps to Pending on-chain.
  const upper = dbStatus.toUpperCase();
  if (upper === "DELIVERED") return OrderStatus.PENDING;
  if (upper === "CONFIRMED") return OrderStatus.COMPLETED;
  return upper;
}

export function isValidOrderStatus(value: string): boolean {
  return (Object.values(OrderStatus) as string[]).includes(value);
}

export function isValidCampaignStatus(value: string): boolean {
  return (Object.values(CampaignStatus) as string[]).includes(value);
}

export function isValidDisputeStatus(value: string): boolean {
  return (Object.values(DisputeStatus) as string[]).includes(value);
}
